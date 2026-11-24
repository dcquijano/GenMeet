# GenMeet

Real-time WebRTC video conferencing, screen sharing, emoji reactions, raised hands, live captions, and in-call chat built with Next.js 15, Socket.IO, native Windows installer tooling, an Android APK wrapper, and iOS/Android PWA support.

## Platform Compatibility

| Platform | How to Install / Run | Camera & Mic WebRTC | Screen Share |
| --- | --- | --- | --- |
| **Windows 10 / 11 (x64)** | `installer/GenMeet-Setup-0.1.6.exe` | Full (`localhost` & HTTPS) | Full |
| **Android 7.0 – 15 (API 24+)** | Download `GenMeet-android-v0.1.6.apk` from [GitHub Releases](https://github.com/dcquijano/GenMeet/releases) **or** Chrome → Install App (PWA) | Full (requires HTTPS server URL) | Browser dependent |
| **iOS / iPadOS (Safari 15+)** | Open GenMeet HTTPS URL in Safari → Share → **Add to Home Screen** (PWA). *(iOS does not support `.apk`; native `.ipa` requires macOS + Xcode + Apple signing.)* | Full (requires HTTPS server URL) | Not supported in iOS WebKit |

---

## How to Connect PC ↔ Phone (Same Wi-Fi OR 5G / Different Wi-Fi)

Your Windows PC hosts the GenMeet server. You have two connection modes:

### Option A: One-Click **Go Public (5G / Internet HTTPS)** — Works on Same Wi-Fi, Different Wi-Fi, or 5G
1. Launch **GenMeet** on your Windows PC (`http://localhost:3000`).
2. Click **Go Public (5G / Internet HTTPS)** on the Home screen, Meeting Lobby, or inside the **Details (`i`)** drawer.
   - GenMeet automatically downloads the official `cloudflared` helper once (into `bin/`) and creates a live `https://<random>.trycloudflare.com` link.
3. Click **Copy Public URL** (or **Copy 5G HTTPS joining info** inside a room) and send it to any phone or PC.
4. On **Android (`GenMeet Mobile` or Chrome)** or **iPhone (Safari)**:
   - Works whether the phone is on **the same Wi-Fi, a different Wi-Fi, or 5G/4G mobile data**.
   - Full **two-way camera & microphone** are enabled because the connection uses real HTTPS.
5. Click **Stop Public Link** anytime (or close GenMeet) to immediately shut down the tunnel.

### Option B: LAN Invite (Same Wi-Fi Only)

Both devices must be on the **same Wi-Fi network**, and you must always use the **LAN Invite** (`http://<PC-LAN-IP>:3000/...`), **never** `localhost`.

### 1. PC → Phone (Host on PC, Join from Phone)
1. Launch **GenMeet** on your Windows PC and click **New meeting → Start an instant meeting**.
2. Open the **Details (`i`)** button at the bottom-right to view your **LAN invite** (for example `http://192.168.8.171:3000/meet/hbk-uwsa-izk`) or click **Copy joining info**.
3. On your **Android phone**, open **GenMeet Mobile**:
   - **1. GenMeet Server URL:** Enter `http://192.168.8.171:3000` *(or simply `192.168.8.171` — auto-adds `:3000`, or paste the entire LAN invite link!)*
   - **2. Meeting Code:** Enter `hbk-uwsa-izk` *(auto-filled if you pasted the full LAN invite link)*.
   - Tap **Connect to GenMeet** → enter your display name → tap **Join now**.
4. On **iPhone / iPad (Safari)**: Open the **LAN invite** link directly in Safari (or use **Go Public (HTTPS)** above for live camera/mic).

### 2. Phone → PC (Start Meeting on Phone, Join from PC)
1. Ensure **GenMeet** is running on your Windows PC (`GenMeet-Launcher.exe`).
2. Open **GenMeet Mobile** on your phone, connect to your PC's Public HTTPS URL or LAN URL, and tap **New meeting → Start an instant meeting**.
3. Note the generated meeting code (e.g. `abc-defg-hij`).
4. On your **PC** (`http://localhost:3000`), enter `abc-defg-hij` into **Enter a code or link** and click **Join**.

### 3. Live Camera & Microphone on Mobile (HTTPS Note)
- Over plain `http://192.168.x.x:3000`, phones can connect, see the PC's video, raise hands, react, and chat, **but Android WebView/Chrome and iOS Safari block the phone's own camera & microphone (`getUserMedia`) on non-localhost HTTP**.
- Click **Go Public (5G / Internet HTTPS)** inside GenMeet to unlock two-way live camera & microphone on both Android and iPhone over Wi-Fi or 5G. *(Note: P2P WebRTC uses STUN; strict carrier symmetric NATs or corporate firewalls may still require a TURN relay for direct media.)*

---

## Windows Installer Suite (`installer/`)

Built in the same native Windows Setup Wizard architecture as **Darius DB (Lite Version)**:

- `installer/GenMeet-Setup-0.1.6.exe` — 4-step Windows Setup Wizard (MIT License, destination folder picker, shortcuts & startup options, progress bar + live log, unique per-install Virtual Node ID & free port assignment, clean `.next` upgrade, and `Installed Apps` registration).
- `installer/GenMeet-Launcher.exe` — Starts the GenMeet server cleanly in the background and opens Google Chrome. Supports `--version`, `--terminal`, and `--stop-all`.
- `installer/GenMeet-Updater.exe` — Native Windows GitHub Auto-Updater that checks `dcquijano/GenMeet` for newer versions/builds, downloads the latest Setup EXE, stops the background Node server cleanly, and upgrades in-place while preserving `genmeet.instance.json` & logs.
- `installer/GenMeet-Repair.exe` — Native Windows Repair Wizard for restoring dependencies, builds, shortcuts, and free ports.
- `installer/GenMeet-Uninstall.exe` — Native Windows Uninstall Wizard that cleanly stops GenMeet and removes shortcuts, registry entries, and files.

## Android APK (`mobile/android/`)

- Built automatically on GitHub Actions (`ubuntu-latest`) for every release and published as `GenMeet-android-v0.1.6.apk` on GitHub Releases.
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
