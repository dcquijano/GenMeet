package com.genmeet.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
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
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : AppCompatActivity() {

    private lateinit var rootLayout: FrameLayout
    private lateinit var webView: WebView
    private lateinit var connectScroll: ScrollView
    private lateinit var serverInput: EditText
    private lateinit var codeInput: EditText
    private lateinit var errorBanner: TextView
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
            if (results.values.any { it }) {
                pending.grant(pending.resources)
            } else {
                pending.deny()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        rootLayout = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#17181B"))
        }

        // Respect Android system status bar and gesture navigation insets (fixes Android 15 overlap)
        ViewCompat.setOnApplyWindowInsetsListener(rootLayout) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
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
                        val desc = error?.description?.toString().orEmpty()
                        val failedUrl = request.url?.toString().orEmpty()
                        runOnUiThread {
                            view?.loadUrl("about:blank")
                            val hint = when {
                                failedUrl.contains("localhost", ignoreCase = true) ||
                                    failedUrl.contains("127.0.0.1") ->
                                    "Cannot use 'localhost' on a phone. Enter your PC's LAN IP (e.g. http://192.168.8.171:3000) or HTTPS tunnel URL."
                                desc.contains("ERR_NAME_NOT_RESOLVED", ignoreCase = true) ->
                                    "Host not found ($failedUrl). Put the PC IP/domain in 'Server URL' and the room code in 'Meeting Code'."
                                desc.contains("ERR_CONNECTION_REFUSED", ignoreCase = true) ||
                                    desc.contains("ERR_CONNECTION_TIMED_OUT", ignoreCase = true) ->
                                    "Could not reach $failedUrl. Make sure GenMeet is running on your PC, both devices are on the same Wi-Fi, and Windows Firewall allows port 3000."
                                else ->
                                    "Connection failed ($desc). Verify your GenMeet server URL."
                            }
                            showConnectScreen(hint)
                        }
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
        rootLayout.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        // Compact floating "Server" button positioned cleanly below the status bar inset
        switchServerButton = Button(this).apply {
            text = "Server"
            textSize = 11f
            isAllCaps = false
            setTextColor(Color.WHITE)
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#DD1A73E8"))
                cornerRadius = 40f
            }
            visibility = View.GONE
            setPadding(28, 10, 28, 10)
            minHeight = 0
            minimumHeight = 0
            minWidth = 0
            minimumWidth = 0
            setOnClickListener { promptChangeServer() }
        }
        val switchParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            topMargin = 16
            marginEnd = 16
        }
        rootLayout.addView(switchServerButton, switchParams)

        // Native initial server connect screen
        connectScroll = buildConnectScreen()
        rootLayout.addView(
            connectScroll,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        setContentView(rootLayout)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.visibility == View.VISIBLE && webView.canGoBack()) {
                    webView.goBack()
                } else if (webView.visibility == View.VISIBLE) {
                    showConnectScreen(null)
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        requestInitialMediaPermissions()

        val savedServer = prefs.getString(KEY_SERVER_URL, "").orEmpty()
        if (savedServer.isNotBlank()) {
            serverInput.setText(savedServer)
        }
    }

    private fun buildConnectScreen(): ScrollView {
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(Color.parseColor("#F4F8FF"))
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(56, 64, 56, 64)
        }

        val title = TextView(this).apply {
            text = "GenMeet Mobile"
            textSize = 28f
            setTextColor(Color.parseColor("#1A73E8"))
            gravity = Gravity.CENTER
        }
        container.addView(title)

        val subtitle = TextView(this).apply {
            text = "Connect to your PC's GenMeet server (LAN IP or HTTPS URL) and optionally enter a meeting code."
            textSize = 14f
            setTextColor(Color.parseColor("#5F6368"))
            gravity = Gravity.CENTER
            setPadding(0, 14, 0, 28)
        }
        container.addView(subtitle)

        errorBanner = TextView(this).apply {
            visibility = View.GONE
            textSize = 13f
            setTextColor(Color.parseColor("#C5221F"))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#FCE8E6"))
                cornerRadius = 24f
            }
            setPadding(28, 22, 28, 22)
        }
        container.addView(
            errorBanner,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 24 }
        )

        val serverLabel = TextView(this).apply {
            text = "1. GenMeet Server URL (do NOT use localhost)"
            textSize = 12f
            setTextColor(Color.parseColor("#3C4043"))
            setPadding(4, 0, 0, 8)
        }
        container.addView(serverLabel)

        serverInput = EditText(this).apply {
            hint = "e.g. https://xxxx.trycloudflare.com or 192.168.8.171:3000"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setTextColor(Color.parseColor("#202124"))
            setHintTextColor(Color.parseColor("#9AA0A6"))
            setPadding(28, 26, 28, 26)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                setStroke(2, Color.parseColor("#DADCE0"))
                cornerRadius = 20f
            }
        }
        container.addView(
            serverInput,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 20 }
        )

        val codeLabel = TextView(this).apply {
            text = "2. Meeting Code (optional)"
            textSize = 12f
            setTextColor(Color.parseColor("#3C4043"))
            setPadding(4, 0, 0, 8)
        }
        container.addView(codeLabel)

        codeInput = EditText(this).apply {
            hint = "e.g. mkx-cokw-gaa (leave blank for home page)"
            inputType = InputType.TYPE_CLASS_TEXT
            setSingleLine(true)
            setTextColor(Color.parseColor("#202124"))
            setHintTextColor(Color.parseColor("#9AA0A6"))
            setPadding(28, 26, 28, 26)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                setStroke(2, Color.parseColor("#DADCE0"))
                cornerRadius = 20f
            }
        }
        container.addView(
            codeInput,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 28 }
        )

        val connectBtn = Button(this).apply {
            text = "Connect to GenMeet"
            isAllCaps = false
            textSize = 15f
            setTextColor(Color.WHITE)
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#1A73E8"))
                cornerRadius = 60f
            }
            setPadding(32, 26, 32, 26)
            setOnClickListener { handleConnectClick() }
        }
        container.addView(
            connectBtn,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )

        val tip = TextView(this).apply {
            text = "Tip: Find your PC's LAN URL on GenMeet's home screen (e.g. http://192.168.x.x:3000). For camera & mic on phones, use an HTTPS URL (Cloudflare Tunnel / Tailscale)."
            textSize = 12f
            setTextColor(Color.parseColor("#5F6368"))
            gravity = Gravity.CENTER
            setPadding(0, 28, 0, 0)
        }
        container.addView(tip)

        scroll.addView(container)
        return scroll
    }

    private fun handleConnectClick() {
        val rawServer = serverInput.text.toString().trim()
        val rawCode = codeInput.text.toString().trim()

        // Catch when a user accidentally pastes a meeting code into the Server URL box
        if (MEETING_CODE_REGEX.matches(rawServer.lowercase())) {
            codeInput.setText(rawServer.lowercase())
            serverInput.setText(prefs.getString(KEY_SERVER_URL, ""))
            showError("'$rawServer' is a meeting code! Moved it to Meeting Code. Now enter your PC's Server URL above (e.g. http://192.168.8.171:3000 or an HTTPS tunnel).")
            return
        }

        val parsed = parseServerAndOptionalCode(rawServer, rawCode)
        if (parsed.error != null) {
            showError(parsed.error)
            return
        }

        errorBanner.visibility = View.GONE
        prefs.edit().putString(KEY_SERVER_URL, parsed.baseUrl!!).apply()
        serverInput.setText(parsed.baseUrl)
        if (!parsed.meetingCode.isNullOrBlank()) {
            codeInput.setText(parsed.meetingCode)
        }
        openServer(parsed.targetUrl!!)
    }

    private data class ParsedTarget(
        val baseUrl: String? = null,
        val meetingCode: String? = null,
        val targetUrl: String? = null,
        val error: String? = null
    )

    private fun parseServerAndOptionalCode(rawServer: String, rawCode: String): ParsedTarget {
        if (rawServer.isBlank()) {
            return ParsedTarget(error = "Enter your PC's GenMeet Server URL first (e.g. http://192.168.8.171:3000 or https://your-tunnel).")
        }

        val withScheme = when {
            rawServer.startsWith("http://", ignoreCase = true) ||
                rawServer.startsWith("https://", ignoreCase = true) -> rawServer
            IPV4_HOST_REGEX.matches(rawServer.substringBefore("/")) -> "http://$rawServer"
            else -> "https://$rawServer"
        }

        val uri = Uri.parse(withScheme)
        val scheme = uri.scheme?.lowercase()
        val host = uri.host?.lowercase()
        if ((scheme != "http" && scheme != "https") || host.isNullOrBlank()) {
            return ParsedTarget(error = "Enter a valid Server URL (e.g. http://192.168.8.171:3000 or https://xxxx.trycloudflare.com).")
        }

        if (host == "localhost" || host == "127.0.0.1" || host == "::1") {
            return ParsedTarget(
                error = "'localhost' points to your phone, not your PC! Replace 'localhost' with your PC's LAN IP (shown on your PC GenMeet screen, e.g. http://192.168.8.171:3000) or an HTTPS tunnel URL."
            )
        }

        if (!host.contains(".")) {
            return ParsedTarget(
                error = "'$host' does not look like a valid IP address or domain name. Put meeting codes in the Meeting Code field below."
            )
        }

        val portPart = if (uri.port != -1) ":${uri.port}" else ""
        val baseUrl = "$scheme://$host$portPart"

        // Extract /meet/<code> if pasted into Server URL
        var code = rawCode.trim().lowercase()
        if (code.isBlank()) {
            val segments = uri.pathSegments.orEmpty()
            val idx = segments.indexOf("meet")
            if (idx != -1 && idx + 1 < segments.size) {
                code = segments[idx + 1].lowercase()
            }
        } else if (code.contains("/meet/")) {
            code = code.substringAfterLast("/meet/").substringBefore("?").trim().lowercase()
        }

        val targetUrl = if (code.isNotBlank()) "$baseUrl/meet/$code" else baseUrl
        return ParsedTarget(baseUrl = baseUrl, meetingCode = code, targetUrl = targetUrl)
    }

    private fun showError(message: String) {
        errorBanner.text = message
        errorBanner.visibility = View.VISIBLE
    }

    private fun openServer(url: String) {
        connectScroll.visibility = View.GONE
        webView.visibility = View.VISIBLE
        switchServerButton.visibility = View.VISIBLE
        webView.loadUrl(url)
    }

    private fun showConnectScreen(errorMessage: String?) {
        webView.visibility = View.GONE
        switchServerButton.visibility = View.GONE
        connectScroll.visibility = View.VISIBLE
        if (!errorMessage.isNullOrBlank()) {
            showError(errorMessage)
        }
    }

    private fun promptChangeServer() {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 8)
        }
        val srvInput = EditText(this).apply {
            hint = "Server URL (e.g. http://192.168.8.171:3000)"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(prefs.getString(KEY_SERVER_URL, ""))
        }
        val roomInput = EditText(this).apply {
            hint = "Meeting code (optional, e.g. mkx-cokw-gaa)"
            inputType = InputType.TYPE_CLASS_TEXT
            setText(codeInput.text.toString())
        }
        layout.addView(srvInput)
        layout.addView(roomInput)

        AlertDialog.Builder(this)
            .setTitle("Change GenMeet Server / Room")
            .setView(layout)
            .setPositiveButton("Connect") { _, _ ->
                serverInput.setText(srvInput.text.toString().trim())
                codeInput.setText(roomInput.text.toString().trim())
                val parsed = parseServerAndOptionalCode(
                    srvInput.text.toString().trim(),
                    roomInput.text.toString().trim()
                )
                if (parsed.error != null) {
                    Toast.makeText(this, parsed.error, Toast.LENGTH_LONG).show()
                } else {
                    prefs.edit().putString(KEY_SERVER_URL, parsed.baseUrl!!).apply()
                    openServer(parsed.targetUrl!!)
                }
            }
            .setNeutralButton("Home Screen") { _, _ -> showConnectScreen(null) }
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
        private val MEETING_CODE_REGEX = Regex("^[a-z0-9]{2,12}(-[a-z0-9]{2,12}){1,3}$")
        private val IPV4_HOST_REGEX = Regex("^\\d{1,3}(\\.\\d{1,3}){3}(:\\d{1,5})?$")
    }
}
