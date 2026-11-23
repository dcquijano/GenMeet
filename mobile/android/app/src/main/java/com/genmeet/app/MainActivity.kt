package com.genmeet.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var connectContainer: LinearLayout
    private lateinit var urlInput: EditText
    private lateinit var switchServerButton: Button

    private var pendingWebPermission: PermissionRequest? = null

    private val prefs by lazy {
        getSharedPreferences("genmeet_prefs", Context.MODE_PRIVATE)
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        val pending = pendingWebPermission
        pendingWebPermission = null
        if (pending != null) {
            val anyGranted = results.values.any { it }
            if (anyGranted) {
                pending.grant(pending.resources)
            } else {
                pending.deny()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#FFFFFF"))
        }

        // WebView layer
        webView = WebView(this).apply {
            visibility = View.GONE
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?
                ) {
                    if (request?.isForMainFrame == true) {
                        Toast.makeText(
                            this@MainActivity,
                            "Could not reach GenMeet server. Tap 'Server' to change URL.",
                            Toast.LENGTH_LONG
                        ).show()
                        showConnectScreen()
                    }
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread {
                        handleWebRtcPermission(request)
                    }
                }
            }
        }
        root.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        // Subtle floating button to change server URL
        switchServerButton = Button(this).apply {
            text = "Server"
            textSize = 11f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#CC1A73E8"))
            visibility = View.GONE
            setPadding(24, 8, 24, 8)
            setOnClickListener { promptChangeServer() }
        }
        val switchParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            topMargin = 28
            marginEnd = 24
        }
        root.addView(switchServerButton, switchParams)

        // Native initial server connect screen
        connectContainer = buildConnectScreen()
        root.addView(
            connectContainer,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        setContentView(root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.visibility == View.VISIBLE && webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        requestInitialMediaPermissions()

        val savedUrl = prefs.getString(KEY_SERVER_URL, "").orEmpty()
        if (savedUrl.isNotBlank()) {
            urlInput.setText(savedUrl)
            openServer(savedUrl)
        }
    }

    private fun buildConnectScreen(): LinearLayout {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(64, 64, 64, 64)
            setBackgroundColor(Color.parseColor("#F4F8FF"))
        }

        val title = TextView(this).apply {
            text = "GenMeet Mobile"
            textSize = 28f
            setTextColor(Color.parseColor("#1A73E8"))
            gravity = Gravity.CENTER
        }
        container.addView(title)

        val subtitle = TextView(this).apply {
            text = "Enter your GenMeet server URL (HTTPS recommended for camera & microphone)"
            textSize = 14f
            setTextColor(Color.parseColor("#5F6368"))
            gravity = Gravity.CENTER
            setPadding(0, 16, 0, 36)
        }
        container.addView(subtitle)

        urlInput = EditText(this).apply {
            hint = "https://your-genmeet-host or http://192.168.x.x:3000"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setTextColor(Color.parseColor("#202124"))
            setHintTextColor(Color.parseColor("#9AA0A6"))
            setPadding(28, 28, 28, 28)
            setBackgroundColor(Color.WHITE)
        }
        val inputParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            bottomMargin = 28
        }
        container.addView(urlInput, inputParams)

        val connectBtn = Button(this).apply {
            text = "Connect to GenMeet"
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#1A73E8"))
            setPadding(32, 24, 32, 24)
            setOnClickListener {
                val raw = urlInput.text.toString().trim()
                val validated = normalizeServerUrl(raw)
                if (validated == null) {
                    Toast.makeText(
                        this@MainActivity,
                        "Enter a valid http:// or https:// URL",
                        Toast.LENGTH_SHORT
                    ).show()
                } else {
                    prefs.edit().putString(KEY_SERVER_URL, validated).apply()
                    openServer(validated)
                }
            }
        }
        container.addView(
            connectBtn,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )

        val note = TextView(this).apply {
            text = "Tip: Android WebView requires HTTPS (e.g. Cloudflare Tunnel / Tailscale / reverse proxy) for camera & mic access over LAN or Internet."
            textSize = 12f
            setTextColor(Color.parseColor("#5F6368"))
            gravity = Gravity.CENTER
            setPadding(0, 32, 0, 0)
        }
        container.addView(note)

        return container
    }

    private fun normalizeServerUrl(raw: String): String? {
        if (raw.isBlank()) return null
        val withScheme = if (raw.startsWith("http://", ignoreCase = true) ||
            raw.startsWith("https://", ignoreCase = true)
        ) {
            raw
        } else {
            "https://$raw"
        }
        val uri = Uri.parse(withScheme)
        val scheme = uri.scheme?.lowercase() ?: return null
        if ((scheme != "http" && scheme != "https") || uri.host.isNullOrBlank()) {
            return null
        }
        return withScheme
    }

    private fun openServer(url: String) {
        connectContainer.visibility = View.GONE
        webView.visibility = View.VISIBLE
        switchServerButton.visibility = View.VISIBLE
        webView.loadUrl(url)
    }

    private fun showConnectScreen() {
        webView.visibility = View.GONE
        switchServerButton.visibility = View.GONE
        connectContainer.visibility = View.VISIBLE
    }

    private fun promptChangeServer() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(prefs.getString(KEY_SERVER_URL, ""))
        }
        AlertDialog.Builder(this)
            .setTitle("GenMeet Server URL")
            .setView(input)
            .setPositiveButton("Connect") { _, _ ->
                val validated = normalizeServerUrl(input.text.toString().trim())
                if (validated != null) {
                    prefs.edit().putString(KEY_SERVER_URL, validated).apply()
                    urlInput.setText(validated)
                    openServer(validated)
                } else {
                    Toast.makeText(this, "Invalid http:// or https:// URL", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun requestInitialMediaPermissions() {
        val needed = arrayOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO
        ).filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isNotEmpty()) {
            permissionLauncher.launch(needed.toTypedArray())
        }
    }

    private fun handleWebRtcPermission(request: PermissionRequest) {
        val allowed = request.resources.filter {
            it == PermissionRequest.RESOURCE_VIDEO_CAPTURE ||
                it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
        }
        if (allowed.isEmpty()) {
            request.deny()
            return
        }

        val needed = mutableListOf<String>()
        if (allowed.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.CAMERA)
        }
        if (allowed.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.RECORD_AUDIO)
        }

        if (needed.isEmpty()) {
            request.grant(allowed.toTypedArray())
        } else {
            pendingWebPermission?.deny()
            pendingWebPermission = request
            permissionLauncher.launch(needed.toTypedArray())
        }
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val KEY_SERVER_URL = "server_url"
    }
}
