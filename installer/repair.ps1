<#
.SYNOPSIS
  GenMeet (v0.1.0) Repair wrapper.
#>
param(
    [string]$InstallDir = "",
    [switch]$Silent,
    [switch]$ResetConfig,
    [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
$exe = Join-Path $PSScriptRoot "GenMeet-Repair.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    Write-Host "ERROR: GenMeet-Repair.exe not found." -ForegroundColor Red
    exit 1
}

$argsList = @()
if ($InstallDir)  { $argsList += "--dir=$InstallDir" }
if ($Silent)      { $argsList += "--silent" }
if ($ResetConfig) { $argsList += "--reset-config" }
if ($NoLaunch)    { $argsList += "--no-launch" }

Start-Process -FilePath $exe -ArgumentList $argsList -Wait
