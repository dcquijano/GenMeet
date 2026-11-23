@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo ==================================================
echo   GenMeet Installer (Google Meet Clone)
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js is not installed.
  where winget >nul 2>nul
  if not errorlevel 1 (
    set /p INSTALL_NODE="Install Node.js LTS automatically with winget? (Y/N): "
    if /i "!INSTALL_NODE!"=="Y" (
      winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
      echo Please close this window and re-run install.bat after Node.js finishes installing.
      pause
      exit /b 0
    )
  )
  echo Please install Node.js 20+ from https://nodejs.org/ and re-run install.bat.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Found Node.js %NODE_VER%

if not exist "node_modules" (
  echo.
  echo [1/3] Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
) else (
  echo [OK] Dependencies already installed ^(node_modules present^).
)

echo.
echo [2/3] Generating unique per-install identity and port...
node scripts/setup-instance.mjs --reset
if errorlevel 1 (
  echo [ERROR] Failed to configure GenMeet instance.
  pause
  exit /b 1
)

if not exist ".next\BUILD_ID" (
  echo.
  echo [3/3] Building GenMeet for production...
  if exist ".next" rmdir /s /q ".next"
  if exist "tsconfig.tsbuildinfo" del /f /q "tsconfig.tsbuildinfo"
  call npm.cmd run build
  if errorlevel 1 (
    echo [ERROR] Production build failed.
    pause
    exit /b 1
  )
) else (
  echo [OK] Production build already present ^(.next\BUILD_ID^).
)

echo.
set /p CREATE_SHORTCUT="Create a GenMeet shortcut on your Desktop? (Y/N): "
if /i "!CREATE_SHORTCUT!"=="Y" (
  powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\GenMeet.lnk'); $sc.TargetPath = '%~dp0Start-GenMeet.bat'; $sc.WorkingDirectory = '%~dp0'; $sc.Save()"
  echo [OK] Created Desktop shortcut: GenMeet.lnk
)

echo.
set /p LAUNCH_NOW="Start GenMeet in Google Chrome now? (Y/N): "
if /i "!LAUNCH_NOW!"=="Y" (
  call "%~dp0Start-GenMeet.bat"
)

echo.
echo Installation complete! Run Start-GenMeet.bat anytime to launch GenMeet.
pause
