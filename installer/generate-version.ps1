<#
.SYNOPSIS
  Auto-generates version.json from git commits for GenMeet GitHub releases & updater.
#>
param(
    [string]$Version = "",
    [string]$RepoSlug = "dcquijano/GenMeet",
    [string]$OutputPath = "",
    [switch]$KeepBuild
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $OutputPath) { $OutputPath = Join-Path $RepoRoot "version.json" }

Push-Location $RepoRoot
try {
    if (-not $Version -and (Test-Path "package.json")) {
        $pkg = Get-Content "package.json" -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($pkg.version) { $Version = ([string]$pkg.version).Trim().TrimStart("v") }
    }
    if (-not $Version) { $Version = "0.1.2" }

    $existingBuild = ""
    if ($KeepBuild -and (Test-Path $OutputPath)) {
        try {
            $old = Get-Content $OutputPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($old.build) { $existingBuild = [string]$old.build }
        } catch {}
    }

    $buildId = if ($existingBuild) { $existingBuild } else { (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmm") }
    $releasedAt = (Get-Date).ToString("yyyy-MM-dd")

    $latestCommit = ""
    $changelog = New-Object System.Collections.Generic.List[string]
    try {
        $latestCommit = (git rev-parse --short HEAD 2>$null).Trim()
        $gitLines = @(git log -n 20 --pretty=format:"[%h] %s (%ad)" --date=short 2>$null)
        foreach ($line in $gitLines) {
            if ($line -and $line.Trim() -ne "") {
                $changelog.Add($line.Trim())
            }
        }
    } catch {}

    $summaryItems = @($changelog | Select-Object -First 3)
    $announcement = if ($summaryItems.Count -gt 0) {
        "GenMeet (v$Version) - Latest updates: " + ($summaryItems -join "; ")
    } else {
        "GenMeet (v$Version) - Real-time WebRTC video meetings."
    }

    $payload = [ordered]@{
        name             = "GenMeet (v$Version)"
        version          = $Version
        build            = $buildId
        releasedAt       = $releasedAt
        author           = "Darius Cumpio"
        latestCommit     = $latestCommit
        directSetupUrl   = "https://github.com/$RepoSlug/releases/download/v$Version/GenMeet-Setup-$Version.exe"
        directZipUrl     = "https://github.com/$RepoSlug/releases/download/v$Version/GenMeet-$Version-portable-windows-amd64.zip"
        fallbackSetupUrl = "https://raw.githubusercontent.com/$RepoSlug/main/installer/GenMeet-Setup-$Version.exe"
        repoUrl          = "https://github.com/$RepoSlug"
        announcement     = $announcement
        changelog        = @($changelog)
    }

    $json = $payload | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($OutputPath, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Generated $OutputPath (v$Version, build $buildId)" -ForegroundColor Green
}
finally {
    Pop-Location
}
