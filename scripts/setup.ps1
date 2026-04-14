#Requires -Version 5.1
<#
.SYNOPSIS
    mineblade — instant Minecraft server setup for Windows
    https://github.com/OutBlade/mineblade
#>

Set-StrictMode -Off
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ── Colours ──────────────────────────────────────────────────────────────────
function Write-Header {
    Clear-Host
    Write-Host ""
    Write-Host "  MINEBLADE" -ForegroundColor White
    Write-Host "  free minecraft server, on your machine" -ForegroundColor DarkGray
    Write-Host ""
}

function Write-Step([string]$msg) {
    Write-Host "  > $msg" -ForegroundColor White
}

function Write-Info([string]$msg) {
    Write-Host "    $msg" -ForegroundColor DarkGray
}

function Write-Ok([string]$msg) {
    Write-Host "  ok  $msg" -ForegroundColor Green
}

function Write-Warn([string]$msg) {
    Write-Host "  !!  $msg" -ForegroundColor Yellow
}

function Write-Fail([string]$msg) {
    Write-Host "  xx  $msg" -ForegroundColor Red
}

# ── Helpers ───────────────────────────────────────────────────────────────────
function Prompt-Choice([string]$question, [string[]]$options) {
    Write-Host ""
    Write-Host "  $question" -ForegroundColor White
    for ($i = 0; $i -lt $options.Count; $i++) {
        Write-Host "    $($i+1). $($options[$i])" -ForegroundColor DarkGray
    }
    do {
        $raw = Read-Host "    choice"
        $n = 0
        $valid = [int]::TryParse($raw, [ref]$n) -and $n -ge 1 -and $n -le $options.Count
        if (-not $valid) { Write-Warn "enter a number between 1 and $($options.Count)" }
    } while (-not $valid)
    return $n - 1
}

function Download-File([string]$url, [string]$dest) {
    Write-Info "downloading $([System.IO.Path]::GetFileName($dest))..."
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
}

# ── Java ──────────────────────────────────────────────────────────────────────
function Ensure-Java {
    Write-Step "checking Java..."
    $java = Get-Command java -ErrorAction SilentlyContinue
    if ($java) {
        $ver = & java -version 2>&1 | Select-String "version" | Select-Object -First 1
        Write-Ok "Java found: $ver"
        return
    }

    Write-Warn "Java not found. installing via winget..."
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Write-Fail "winget not available. please install Java 21 manually from https://adoptium.net and re-run this script."
        exit 1
    }
    winget install --id Microsoft.OpenJDK.21 --accept-source-agreements --accept-package-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
    $java = Get-Command java -ErrorAction SilentlyContinue
    if (-not $java) {
        Write-Fail "Java installation succeeded but 'java' command not found. please restart PowerShell and re-run."
        exit 1
    }
    Write-Ok "Java installed."
}

# ── Version lists ─────────────────────────────────────────────────────────────
function Get-VanillaVersions {
    $manifest = Invoke-RestMethod "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"
    return $manifest.versions | Where-Object { $_.type -eq "release" } | Select-Object -First 8
}

function Get-PaperVersions {
    $data = Invoke-RestMethod "https://api.papermc.io/v2/projects/paper"
    return $data.versions | Select-Object -Last 8
}

function Get-FabricVersions {
    $data = Invoke-RestMethod "https://meta.fabricmc.net/v2/versions/game"
    return ($data | Where-Object { $_.stable -eq $true } | Select-Object -First 8).version
}

# ── Server download ───────────────────────────────────────────────────────────
function Download-Vanilla([string]$version, [string]$dir) {
    $manifest = Invoke-RestMethod "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"
    $entry = $manifest.versions | Where-Object { $_.id -eq $version } | Select-Object -First 1
    $versionMeta = Invoke-RestMethod $entry.url
    $serverUrl = $versionMeta.downloads.server.url
    Download-File $serverUrl "$dir\server.jar"
}

function Download-Paper([string]$version, [string]$dir) {
    $builds = Invoke-RestMethod "https://api.papermc.io/v2/projects/paper/versions/$version/builds"
    $latest = $builds.builds | Select-Object -Last 1
    $build = $latest.build
    $jar = $latest.downloads.application.name
    $url = "https://api.papermc.io/v2/projects/paper/versions/$version/builds/$build/downloads/$jar"
    Download-File $url "$dir\server.jar"
}

function Download-Fabric([string]$version, [string]$dir) {
    $installers = Invoke-RestMethod "https://meta.fabricmc.net/v2/versions/installer"
    $installer = ($installers | Select-Object -First 1).url
    Download-File $installer "$dir\fabric-installer.jar"
    Write-Info "running Fabric installer for $version..."
    & java -jar "$dir\fabric-installer.jar" server -mcversion $version -downloadMinecraft -dir $dir
    Remove-Item "$dir\fabric-installer.jar" -ErrorAction SilentlyContinue
    # Fabric creates fabric-server-launch.jar; rename for dashboard compatibility
    $fabricJar = Get-ChildItem $dir -Filter "fabric-server-launch.jar" | Select-Object -First 1
    if ($fabricJar) {
        Copy-Item $fabricJar.FullName "$dir\server.jar"
    }
}

function Download-Forge([string]$version, [string]$dir) {
    Write-Warn "Forge auto-install is not supported yet."
    Write-Info "please download the Forge installer manually from https://files.minecraftforge.net"
    Write-Info "place the server jar in: $dir"
    Write-Info "rename it to server.jar, then run the dashboard."
    pause
}

# ── Server config ─────────────────────────────────────────────────────────────
function Write-ServerConfig([string]$dir, [int]$maxPlayers, [int]$ramMb) {
    Set-Content "$dir\eula.txt" "eula=true"

    $props = @"
server-port=25565
max-players=$maxPlayers
difficulty=normal
gamemode=survival
online-mode=true
enable-rcon=false
motd=mineblade server
"@
    Set-Content "$dir\server.properties" $props
    Write-Ok "server.properties written (port 25565, $maxPlayers players, $($ramMb)MB RAM)"
}

# ── Firewall ──────────────────────────────────────────────────────────────────
function Open-Firewall {
    Write-Step "opening firewall port 25565..."
    $existing = Get-NetFirewallRule -DisplayName "Minecraft - mineblade" -ErrorAction SilentlyContinue
    if (-not $existing) {
        New-NetFirewallRule -DisplayName "Minecraft - mineblade" `
            -Direction Inbound -Protocol TCP -LocalPort 25565 -Action Allow | Out-Null
        Write-Ok "firewall rule added."
    } else {
        Write-Ok "firewall rule already exists."
    }
}

# ── Dashboard ─────────────────────────────────────────────────────────────────
function Install-Dashboard([string]$dir) {
    Write-Step "installing dashboard..."
    $base = "https://raw.githubusercontent.com/OutBlade/mineblade/main/dashboard"
    New-Item -ItemType Directory -Path "$dir\dashboard" -Force | Out-Null
    Download-File "$base/dashboard.py" "$dir\dashboard\dashboard.py"
    Download-File "$base/index.html" "$dir\dashboard\index.html"
    Write-Ok "dashboard installed."
}

function Start-Dashboard([string]$dir, [int]$ramMb) {
    Write-Step "starting dashboard at http://localhost:8080 ..."
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCmd) { $pythonCmd = Get-Command python3 -ErrorAction SilentlyContinue }
    if (-not $pythonCmd) {
        Write-Warn "Python not found. attempting install via winget..."
        winget install --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
        $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    }
    if (-not $pythonCmd) {
        Write-Fail "Python not available. dashboard will not start. start the server manually with: java -Xmx${ramMb}m -jar $dir\server.jar --nogui"
        return
    }

    $env:MINEBLADE_SERVER_DIR = $dir
    $env:MINEBLADE_RAM_MB = $ramMb
    Start-Process -FilePath $pythonCmd.Source -ArgumentList "`"$dir\dashboard\dashboard.py`"" `
        -WorkingDirectory $dir -WindowStyle Hidden
    Start-Sleep -Seconds 2
    Start-Process "http://localhost:8080"
    Write-Ok "dashboard started. browser opened."
}

# ── Port forwarding info ──────────────────────────────────────────────────────
function Show-PortForwardingInfo {
    Write-Host ""
    Write-Host "  PORT FORWARDING" -ForegroundColor White
    Write-Host "  to let friends outside your network join:" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "    1. find your router IP (usually 192.168.1.1 or 192.168.0.1)" -ForegroundColor DarkGray
    Write-Host "    2. log in and find 'Port Forwarding'" -ForegroundColor DarkGray
    Write-Host "    3. forward TCP port 25565 to this machine's local IP" -ForegroundColor DarkGray
    Write-Host ""

    $localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
        $_.IPAddress -notmatch "^127\." -and $_.IPAddress -notmatch "^169\."
    } | Select-Object -First 1).IPAddress

    Write-Host "    your local IP: $localIP" -ForegroundColor White
    Write-Host "    your public IP: check https://whatismyipaddress.com" -ForegroundColor DarkGray
    Write-Host ""
}

# ── Main ──────────────────────────────────────────────────────────────────────
Write-Header
Ensure-Java

# Server directory
$serverDir = "$env:USERPROFILE\mineblade-server"
New-Item -ItemType Directory -Path $serverDir -Force | Out-Null
Write-Ok "server folder: $serverDir"

# Server type
$typeIdx = Prompt-Choice "server type:" @("Vanilla (official Mojang)", "Paper (performance)", "Fabric (mod loader)", "Forge (mod loader)")

# Version
Write-Step "fetching available versions..."
switch ($typeIdx) {
    0 {
        $versions = Get-VanillaVersions | ForEach-Object { $_.id }
        $vIdx = Prompt-Choice "Minecraft version:" $versions
        $mcVersion = $versions[$vIdx]
    }
    1 {
        $versions = Get-PaperVersions
        $vIdx = Prompt-Choice "Minecraft version:" $versions
        $mcVersion = $versions[$vIdx]
    }
    2 {
        $versions = Get-FabricVersions
        $vIdx = Prompt-Choice "Minecraft version:" $versions
        $mcVersion = $versions[$vIdx]
    }
    3 {
        $versions = Get-VanillaVersions | ForEach-Object { $_.id }
        $vIdx = Prompt-Choice "Minecraft version (Forge):" $versions
        $mcVersion = $versions[$vIdx]
    }
}

# RAM
$totalRamMb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)
$suggestedRamMb = [math]::Min([math]::Max([math]::Round($totalRamMb / 2), 1024), 8192)
Write-Host ""
Write-Host "  RAM allocation (MB) — you have ${totalRamMb}MB total, suggested: ${suggestedRamMb}MB" -ForegroundColor DarkGray
$rawRam = Read-Host "    enter MB (or press Enter for $suggestedRamMb)"
if ([string]::IsNullOrWhiteSpace($rawRam)) { $ramMb = $suggestedRamMb } else { $ramMb = [int]$rawRam }

# Max players
$rawPlayers = Read-Host "  max players (Enter for 20)"
if ([string]::IsNullOrWhiteSpace($rawPlayers)) { $maxPlayers = 20 } else { $maxPlayers = [int]$rawPlayers }

# Download
Write-Step "downloading $mcVersion server..."
switch ($typeIdx) {
    0 { Download-Vanilla $mcVersion $serverDir }
    1 { Download-Paper   $mcVersion $serverDir }
    2 { Download-Fabric  $mcVersion $serverDir }
    3 { Download-Forge   $mcVersion $serverDir }
}
Write-Ok "server downloaded."

# Configure
Write-ServerConfig $serverDir $maxPlayers $ramMb

# Firewall
Open-Firewall

# Dashboard
Install-Dashboard $serverDir
Start-Dashboard $serverDir $ramMb

# Port forwarding
Show-PortForwardingInfo

Write-Host "  all done. manage your server at http://localhost:8080" -ForegroundColor Green
Write-Host ""
