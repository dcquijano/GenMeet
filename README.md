# GenMeet

Real-time WebRTC video conferencing, screen sharing, emoji reactions, raised hands, live captions, and in-call chat built with Next.js 15, Socket.IO, native Windows installer tooling, an Android APK wrapper, and iOS/Android PWA support.

## Platform Compatibility

| Platform | How to Install / Run | Camera & Mic WebRTC | Screen Share |
| --- | --- | --- | --- |
| **Windows 10 / 11 (x64)** | `installer/GenMeet-Setup-0.1.3.exe` | Full (`localhost` & HTTPS) | Full |
| **Android 7.0 – 15 (API 24+)** | Download `GenMeet-android-v0.1.3.apk` from [GitHub Releases](https://github.com/dcquijano/GenMeet/releases) **or** Chrome → Install App (PWA) | Full (requires HTTPS server URL) | Browser dependent |
| **iOS / iPadOS (Safari 15+)** | Open GenMeet HTTPS URL in Safari → Share → **Add to Home Screen** (PWA). *(iOS does not support `.apk`; native `.ipa` requires macOS + Xcode + Apple signing.)* | Full (requires HTTPS server URL) | Not supported in iOS WebKit |

> **Mobile Camera/Mic Note:** Both Android WebView/Chrome and iOS Safari require an **HTTPS** URL for `getUserMedia` (camera & microphone) when connecting across devices. Use a tunnel such as Cloudflare Quick Tunnel (`cloudflared tunnel --url http://localhost:3000`), ngrok, or Tailscale HTTPS in front of your GenMeet server.

## Windows Installer Suite (`installer/`)

Built in the same native Windows Setup Wizard architecture as **Darius DB (Lite Version)**:

- `installer/GenMeet-Setup-0.1.3.exe` — 4-step Windows Setup Wizard (MIT License, destination folder picker, shortcuts & startup options, progress bar + live log, unique per-install Virtual Node ID & free port assignment, and `Installed Apps` registration).
- `installer/GenMeet-Launcher.exe` — Starts the GenMeet server cleanly in the background and opens Google Chrome. Supports `--version`, `--terminal`, and `--stop-all`.
- `installer/GenMeet-Updater.exe` — Native Windows GitHub Auto-Updater that checks `dcquijano/GenMeet` for newer versions/builds, displays the changelog, downloads the latest Setup EXE, and upgrades in-place while preserving `genmeet.instance.json` & logs.
- `installer/GenMeet-Repair.exe` — Native Windows Repair Wizard for restoring dependencies, builds, shortcuts, and free ports.
- `installer/GenMeet-Uninstall.exe` — Native Windows Uninstall Wizard that cleanly stops GenMeet and removes shortcuts, registry entries, and files.

## Android APK (`mobile/android/`)

- Built automatically on GitHub Actions (`ubuntu-latest`) for every release and published as `GenMeet-android-v0.1.3.apk` on GitHub Releases.
- Local build (requires JDK 17 + Android SDK + Gradle 8.10+):

```bash
cd mobile/android
gradle assembleDebug
```

## Development

```powershell
npm.cmd install
npm.cmd run dev
```

Run verification & Windows build:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run lint
powershell -ExecutionPolicy Bypass -File installer\build-all.ps1
```
