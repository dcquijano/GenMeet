# GenMeet

Real-time WebRTC video conferencing, screen sharing, emoji reactions, raised hands, live captions, and in-call chat built with Next.js 15, Socket.IO, and native Windows installer tooling.

## Windows Installer Suite (`installer/`)

Built in the same native Windows Setup Wizard architecture as **Darius DB (Lite Version)**:

- `installer/GenMeet-Setup-0.1.2.exe` — 4-step Windows Setup Wizard (MIT License, destination folder picker, shortcuts & startup options, progress bar + live log, unique per-install Virtual Node ID & free port assignment, and `Installed Apps` registration).
- `installer/GenMeet-Launcher.exe` — Starts the GenMeet server cleanly in the background and opens Google Chrome. Supports `--version`, `--terminal`, and `--stop-all`.
- `installer/GenMeet-Updater.exe` — Native Windows GitHub Auto-Updater that checks `dcquijano/GenMeet` for newer versions/builds, displays the changelog, downloads the latest Setup EXE, and upgrades in-place while preserving `genmeet.instance.json` & logs.
- `installer/GenMeet-Repair.exe` — Native Windows Repair Wizard for restoring dependencies, builds, shortcuts, and free ports.
- `installer/GenMeet-Uninstall.exe` — Native Windows Uninstall Wizard that cleanly stops GenMeet and removes shortcuts, registry entries, and files.

## Development

```powershell
npm.cmd install
npm.cmd run dev
```

Run tests, typecheck, lint, and build:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Build the Windows installer suite & portable ZIP:

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-all.ps1
```
