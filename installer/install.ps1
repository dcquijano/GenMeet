<#
.SYNOPSIS
  GenMeet (v0.1.0) Windows Installer wrapper.
  Launches GenMeet-Setup-0.1.0.exe with optional silent/directory flags.
#>
param(
    [string]$InstallDir = "C:\GenMeet",
    [switch]$Silent,
    [switch]$Force,
    [switch]$Repair,
    [switch]$ResetConfig,
    [switch]$AutoStart,
    [switch]$NoDesktop
)

$ErrorActionPreference = "Stop"
$setupExe = Get-ChildItem -Path $PSScriptRoot -Filter "GenMeet-Setup-*.exe" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1

if (-not $setupExe) {
    Write-Host "ERROR: GenMeet-Setup-*.exe not found. Build it with .\installer\build-all.ps1" -ForegroundColor Red
    exit 1
}

$argsList = @("--dir=$InstallDir")
if ($Silent)      { $argsList += "--silent" }
if ($Force)       { $argsList += "--force" }
if ($Repair)      { $argsList += "--repair" }
if ($ResetConfig) { $argsList += "--reset-config" }
if ($AutoStart)   { $argsList += "--autostart" }
if ($NoDesktop)   { $argsList += "--no-desktop" }

Start-Process -FilePath $setupExe.FullName -ArgumentList $argsList -Wait
