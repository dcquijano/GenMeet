<#
.SYNOPSIS
  GenMeet (v0.1.0) Uninstall wrapper.
#>
param(
    [string]$InstallDir = "",
    [switch]$Silent,
    [switch]$RemoveData
)

$ErrorActionPreference = "Stop"
$exe = Join-Path $PSScriptRoot "GenMeet-Uninstall.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    Write-Host "ERROR: GenMeet-Uninstall.exe not found." -ForegroundColor Red
    exit 1
}

$argsList = @()
if ($InstallDir) { $argsList += "--dir=$InstallDir" }
if ($Silent)     { $argsList += "--silent" }
if ($RemoveData) { $argsList += "--remove-data" } else { $argsList += "--keep-data" }

Start-Process -FilePath $exe -ArgumentList $argsList -Wait
