<#
.SYNOPSIS
  GenMeet GitHub Updater wrapper for Windows.
  Launches GenMeet-Updater.exe or performs silent in-place upgrade from GitHub.
#>
param(
    [string]$InstallDir = "",
    [string]$Token = "",
    [switch]$Silent
)

$ErrorActionPreference = "Stop"

if (-not $InstallDir) {
    $reg = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\GenMeet" -ErrorAction SilentlyContinue
    if ($reg -and $reg.InstallLocation) {
        $InstallDir = $reg.InstallLocation
    } else {
        $InstallDir = "C:\GenMeet"
    }
}

$exe = Join-Path $PSScriptRoot "GenMeet-Updater.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    $installed = Join-Path $InstallDir "GenMeet-Updater.exe"
    if (Test-Path -LiteralPath $installed) { $exe = $installed }
}

if (-not (Test-Path -LiteralPath $exe)) {
    Write-Host "ERROR: GenMeet-Updater.exe not found. Build it with .\installer\build-all.ps1" -ForegroundColor Red
    exit 1
}

$argsList = @("--dir=$InstallDir")
if ($Silent) { $argsList += "--silent" }
if ($Token)  { $argsList += "--token=$Token" }

Start-Process -FilePath $exe -ArgumentList $argsList -Wait
