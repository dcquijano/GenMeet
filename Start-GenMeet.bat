@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "genmeet.instance.json" (
  node scripts/setup-instance.mjs
)

for /f "usebackq tokens=*" %%p in (`node -e "const fs=require('fs'); try{const cfg=JSON.parse(fs.readFileSync('genmeet.instance.json','utf8')); console.log(cfg.port||3000);}catch{console.log(3000);}"`) do set GENMEET_PORT=%%p
if "%GENMEET_PORT%"=="" set GENMEET_PORT=3000

REM Check if GenMeet is already running on this port
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:%GENMEET_PORT%/api/health' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1"
if not errorlevel 1 (
  echo GenMeet is already running on http://localhost:%GENMEET_PORT%
  goto :open_browser
)

if not exist ".next\BUILD_ID" (
  echo Building GenMeet for first run...
  if exist ".next" rmdir /s /q ".next"
  if exist "tsconfig.tsbuildinfo" del /f /q "tsconfig.tsbuildinfo"
  call npm.cmd run build
  if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. Please run install.bat first.
    pause
    exit /b 1
  )
)

if not exist ".next\BUILD_ID" (
  echo [ERROR] Production build missing ^(.next\BUILD_ID^). Please run install.bat.
  pause
  exit /b 1
)

echo Starting GenMeet server on http://localhost:%GENMEET_PORT% ...
start "GenMeet Server" cmd /k "cd /d "%~dp0" && npm.cmd run start"

echo Waiting for GenMeet to become ready...
powershell -NoProfile -Command "for ($i=0; $i -lt 40; $i++) { try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:%GENMEET_PORT%/api/health' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }; exit 1"
if errorlevel 1 (
  echo [!] Server did not respond in time. Check the 'GenMeet Server' window for details.
  pause
  exit /b 1
)

:open_browser
set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "%CHROME_EXE%" (
  start "" "%CHROME_EXE%" "http://localhost:%GENMEET_PORT%"
) else (
  start "" "http://localhost:%GENMEET_PORT%"
)
