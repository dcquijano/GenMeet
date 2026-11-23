<#
.SYNOPSIS
  Builds GenMeet Launcher, Repair, Updater, Uninstaller, Portable ZIP, and self-contained GenMeet-Setup.exe.
#>
param(
    [switch]$SkipNextBuild,
    [switch]$SkipVersionGen
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Version = "0.1.2"
if (Test-Path (Join-Path $RepoRoot "package.json")) {
    try {
        $pkg = Get-Content (Join-Path $RepoRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($pkg.version) { $Version = ([string]$pkg.version).Trim().TrimStart("v") }
    } catch {}
}

Push-Location $RepoRoot
try {
    $genVer = Join-Path $RepoRoot "installer\generate-version.ps1"
    if (-not $SkipVersionGen -and (Test-Path $genVer)) {
        Write-Host "==> Generating version.json from git history..." -ForegroundColor Cyan
        & $genVer -Version $Version
    }

    if (-not $SkipNextBuild -or -not (Test-Path ".next\BUILD_ID")) {
        Write-Host "==> Building Next.js production bundle..." -ForegroundColor Cyan
        Remove-Item -Recurse -Force ".next", "tsconfig.tsbuildinfo" -ErrorAction SilentlyContinue
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw "next build failed" }
    }

    Write-Host "==> Generating GenMeet icons & PE resources..." -ForegroundColor Cyan
    & go run scripts/gen-icon.go
    if ($LASTEXITCODE -ne 0) { throw "gen-icon.go failed" }

    New-Item -ItemType Directory -Force -Path "build\bin", "dist", "installer" | Out-Null
    Remove-Item -Force "dist\*", "installer\*.exe", "build\bin\*.exe" -ErrorAction SilentlyContinue

    Write-Host "==> Building GenMeet-Launcher.exe..." -ForegroundColor Cyan
    & go build -ldflags "-s -w -H=windowsgui" -o "build\bin\GenMeet-Launcher.exe" ./cmd/launcher
    if ($LASTEXITCODE -ne 0) { throw "building GenMeet-Launcher.exe failed" }

    Write-Host "==> Building GenMeet-Repair.exe..." -ForegroundColor Cyan
    & go build -ldflags "-s -w -H=windowsgui" -o "build\bin\GenMeet-Repair.exe" ./cmd/repair
    if ($LASTEXITCODE -ne 0) { throw "building GenMeet-Repair.exe failed" }

    Write-Host "==> Building GenMeet-Updater.exe..." -ForegroundColor Cyan
    & go build -ldflags "-s -w -H=windowsgui" -o "build\bin\GenMeet-Updater.exe" ./cmd/updater
    if ($LASTEXITCODE -ne 0) { throw "building GenMeet-Updater.exe failed" }

    Write-Host "==> Building GenMeet-Uninstall.exe..." -ForegroundColor Cyan
    & go build -ldflags "-s -w -H=windowsgui" -o "build\bin\GenMeet-Uninstall.exe" ./cmd/uninstaller
    if ($LASTEXITCODE -ne 0) { throw "building GenMeet-Uninstall.exe failed" }

    Write-Host "==> Packaging portable ZIP & self-contained GenMeet-Setup-$Version.exe..." -ForegroundColor Cyan
    $stageDir = Join-Path $RepoRoot "dist\GenMeet-$Version-portable"
    $zipPath  = Join-Path $RepoRoot "dist\GenMeet-$Version-portable-windows-amd64.zip"
    $setupExe = Join-Path $RepoRoot "dist\GenMeet-Setup-$Version.exe"
    $embedPayload = Join-Path $RepoRoot "cmd\installer\payload.zip"

    Remove-Item -Recurse -Force $stageDir -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

    Copy-Item "build\bin\GenMeet-Launcher.exe"  $stageDir
    Copy-Item "build\bin\GenMeet-Repair.exe"    $stageDir
    Copy-Item "build\bin\GenMeet-Updater.exe"   $stageDir
    Copy-Item "build\bin\GenMeet-Uninstall.exe" $stageDir

    foreach ($file in @(
        "server.ts", "package.json", "package-lock.json",
        "next.config.mjs", "tsconfig.json", "postcss.config.mjs",
        "LICENSE", "README.md", "version.json"
    )) {
        if (Test-Path $file) { Copy-Item -Force $file $stageDir }
    }

    Copy-Item -Recurse -Force "src" (Join-Path $stageDir "src")
    if (Test-Path "public") { Copy-Item -Recurse -Force "public" (Join-Path $stageDir "public") }
    Copy-Item -Recurse -Force "scripts" (Join-Path $stageDir "scripts")
    Copy-Item -Recurse -Force ".next" (Join-Path $stageDir ".next")
    Remove-Item -Recurse -Force (Join-Path $stageDir ".next\cache") -ErrorAction SilentlyContinue

    Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($stageDir, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    Remove-Item -Recurse -Force $stageDir

    Copy-Item -Force $zipPath $embedPayload
    try {
        & go build -tags "embedzip" -ldflags "-s -w -H=windowsgui" -o $setupExe ./cmd/installer
        if ($LASTEXITCODE -ne 0) { throw "building GenMeet-Setup-$Version.exe failed" }
    }
    finally {
        Remove-Item -Force $embedPayload -ErrorAction SilentlyContinue
    }

    Copy-Item -Force $setupExe "installer\GenMeet-Setup-$Version.exe"
    Copy-Item -Force "build\bin\GenMeet-Launcher.exe"  "installer\GenMeet-Launcher.exe"
    Copy-Item -Force "build\bin\GenMeet-Repair.exe"    "installer\GenMeet-Repair.exe"
    Copy-Item -Force "build\bin\GenMeet-Updater.exe"   "installer\GenMeet-Updater.exe"
    Copy-Item -Force "build\bin\GenMeet-Uninstall.exe" "installer\GenMeet-Uninstall.exe"

    Write-Host ""
    Write-Host "==> Build outputs:" -ForegroundColor Green
    Get-ChildItem "dist\*", "installer\*.exe" -ErrorAction SilentlyContinue |
        Select-Object Name, @{N = "SizeMB"; E = { [math]::Round($_.Length / 1MB, 2) } }, FullName |
        Format-Table -AutoSize
}
finally {
    Pop-Location
}
