#Requires -Version 5.1
<#
.SYNOPSIS
    mineblade - instant Minecraft server setup for Windows
    https://github.com/OutBlade/mineblade
#>

# -- Self-elevate execution policy so the script always runs ------------------
if ($MyInvocation.InvocationName -ne '.' -and $MyInvocation.ScriptName -ne '') {
    $policy = Get-ExecutionPolicy -Scope Process
    if ($policy -eq 'Restricted' -or $policy -eq 'AllSigned') {
        $script = $MyInvocation.MyCommand.Path
        Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$script`"" -Verb RunAs
        exit
    }
}

Set-StrictMode -Off
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# -- Global error trap - keeps window open on any failure ---------------------
trap {
    Write-Host ""
    Write-Host "  ERROR: $_" -ForegroundColor Red
    Write-Host ""
    Read-Host "  Press Enter to close"
    exit 1
}

# -- Colours ------------------------------------------------------------------
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

# -- Helpers -------------------------------------------------------------------
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

# -- Java ----------------------------------------------------------------------
# Strategy: enumerate EVERY java.exe on the system (PATH, registry, filesystem,
# JAVA_HOME), probe each one's version, pick the highest that meets the requirement.
# No silent failures - every candidate is logged. This is the script that the
# mineblade dashboard uses too, ported from dashboard.py's find_best_java().

# Run java -version against an explicit path and return the major version int.
# Java writes -version output to stderr; PowerShell with EAP=Stop treats that
# as a terminating error, so we force Continue inside this function.
function Get-JavaMajorVersion([string]$javaExe) {
    if (-not $javaExe -or -not (Test-Path $javaExe)) { return 0 }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = & $javaExe -version 2>&1 | ForEach-Object { "$_" } | Out-String
        if ($raw -match '"(\d+)') { return [int]$Matches[1] }
    } catch {} finally {
        $ErrorActionPreference = $prevEap
    }
    return 0
}

# Find EVERY java.exe on the system. Returns a list of absolute paths.
function Find-AllJavaExes {
    $found = New-Object System.Collections.Generic.HashSet[string]

    # 1. Current session PATH
    $cmd = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($cmd) { [void]$found.Add($cmd.Source) }

    # 2. System + User PATH from registry (current session may be stale)
    $regPath = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
               [System.Environment]::GetEnvironmentVariable("PATH", "User")
    foreach ($p in ($regPath -split ";" | Where-Object { $_ })) {
        $j = Join-Path $p "java.exe"
        if (Test-Path -LiteralPath $j) { [void]$found.Add((Resolve-Path $j).Path) }
    }

    # 3. JAVA_HOME in any scope
    foreach ($scope in @("Machine", "User", "Process")) {
        $jh = [System.Environment]::GetEnvironmentVariable("JAVA_HOME", $scope)
        if ($jh) {
            $j = Join-Path $jh.TrimEnd("\") "bin\java.exe"
            if (Test-Path -LiteralPath $j) { [void]$found.Add((Resolve-Path $j).Path) }
        }
    }

    # 4. Registry: JDK installer keys (Eclipse Adoptium, Microsoft, Oracle, etc.)
    $regBases = @(
        'HKLM:\SOFTWARE\Eclipse Adoptium\JDK',
        'HKLM:\SOFTWARE\Eclipse Adoptium\JRE',
        'HKLM:\SOFTWARE\Eclipse Foundation\JDK',
        'HKLM:\SOFTWARE\AdoptOpenJDK\JDK',
        'HKLM:\SOFTWARE\JavaSoft\JDK',
        'HKLM:\SOFTWARE\JavaSoft\Java Development Kit',
        'HKLM:\SOFTWARE\Microsoft\JDK',
        'HKLM:\SOFTWARE\Amazon Corretto',
        'HKLM:\SOFTWARE\Azul Systems\Zulu'
    )
    foreach ($base in $regBases) {
        if (-not (Test-Path $base)) { continue }
        $versions = Get-ChildItem -Path $base -ErrorAction SilentlyContinue
        foreach ($ver in $versions) {
            # Try every plausible subkey layout that vendors use
            $candidateKeys = @(
                $ver.PSPath,
                (Join-Path $ver.PSPath 'hotspot\MSI'),
                (Join-Path $ver.PSPath 'MSI')
            )
            foreach ($key in $candidateKeys) {
                if (-not (Test-Path $key)) { continue }
                $props = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
                if (-not $props) { continue }
                foreach ($propName in @('Path', 'JavaHome', 'InstallationPath')) {
                    $install = $props.$propName
                    if ($install -is [string] -and $install.Length -gt 0) {
                        $j = Join-Path $install.TrimEnd('\') 'bin\java.exe'
                        if (Test-Path -LiteralPath $j) { [void]$found.Add((Resolve-Path $j).Path) }
                    }
                }
            }
        }
    }

    # 5. Brute-force filesystem scan - catches every JDK regardless of how it was installed
    $scanDirs = @(
        "$env:ProgramFiles\Eclipse Adoptium",
        "$env:ProgramFiles\Eclipse Foundation",
        "$env:ProgramFiles\Microsoft",
        "$env:ProgramFiles\Java",
        "$env:ProgramFiles\OpenJDK",
        "$env:ProgramFiles\Zulu",
        "$env:ProgramFiles\BellSoft",
        "$env:ProgramFiles\Amazon Corretto",
        "${env:ProgramFiles(x86)}\Java",
        "${env:ProgramFiles(x86)}\Eclipse Adoptium",
        "$env:LOCALAPPDATA\Programs\Eclipse Adoptium",
        "$env:LOCALAPPDATA\Programs\Microsoft\jdk"
    )
    foreach ($base in $scanDirs) {
        if (-not $base -or -not (Test-Path $base)) { continue }
        Get-ChildItem -Path $base -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $j = Join-Path $_.FullName 'bin\java.exe'
            if (Test-Path -LiteralPath $j) { [void]$found.Add((Resolve-Path $j).Path) }
        }
    }

    return $found
}

# Pick the highest-version java.exe that meets the minimum requirement.
# Returns a hashtable @{ Exe = "..."; Version = 26 } or @{ Exe = $null; Version = 0 }.
function Find-BestJava([int]$minVersion) {
    $candidates = Find-AllJavaExes
    if ($candidates.Count -eq 0) {
        Write-Info "no java.exe found anywhere on the system."
        return @{ Exe = $null; Version = 0 }
    }

    Write-Info "scanning $($candidates.Count) java installation(s)..."
    $bestExe = $null
    $bestVer = 0
    foreach ($exe in $candidates) {
        $v = Get-JavaMajorVersion $exe
        $mark = if ($v -ge $minVersion) { "ok" } else { "--" }
        Write-Info "  [$mark] Java $v - $exe"
        if ($v -ge $minVersion -and $v -gt $bestVer) {
            $bestExe = $exe
            $bestVer = $v
        }
    }
    return @{ Exe = $bestExe; Version = $bestVer }
}

# Ask Mojang what Java version this MC version actually requires.
function Get-RequiredJavaVersion([string]$mcVersion) {
    try {
        Write-Info "checking Java requirement for Minecraft $mcVersion..."
        $manifest = Invoke-RestMethod "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"
        $entry = $manifest.versions | Where-Object { $_.id -eq $mcVersion } | Select-Object -First 1
        if (-not $entry) { return 21 }
        $meta = Invoke-RestMethod $entry.url
        $required = [int]$meta.javaVersion.majorVersion
        Write-Info "Minecraft $mcVersion requires Java $required."
        return $required
    } catch {
        Write-Info "could not fetch Java requirement, assuming 21."
        return 21
    }
}

# Try to install a Java version via winget. Only tries packages that actually exist.
function Install-Java([int]$minVersion = 21) {
    Write-Warn "installing Java $minVersion+ via winget..."
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "winget not available. download Java $minVersion+ from https://adoptium.net and re-run."
    }

    # Known-good LTS + current packages. Ordered highest-first so we prefer the newest.
    # Don't probe future versions that don't exist yet - that just noisily fails.
    $allCandidates = @(
        @{ Id = "Microsoft.OpenJDK.25";          Version = 25 },
        @{ Id = "EclipseAdoptium.Temurin.25.JDK"; Version = 25 },
        @{ Id = "Microsoft.OpenJDK.21";          Version = 21 },
        @{ Id = "EclipseAdoptium.Temurin.21.JDK"; Version = 21 },
        @{ Id = "Microsoft.OpenJDK.17";          Version = 17 },
        @{ Id = "EclipseAdoptium.Temurin.17.JDK"; Version = 17 }
    )
    $candidates = $allCandidates | Where-Object { $_.Version -ge $minVersion }

    if ($candidates.Count -eq 0) {
        throw "no known winget package provides Java $minVersion+. download from https://adoptium.net"
    }

    foreach ($pkg in $candidates) {
        Write-Info "trying $($pkg.Id)..."
        & winget install --id $pkg.Id --exact --silent --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
        # 0 = success, -1978335135 = already installed - both are fine
        if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq -1978335135) {
            Write-Ok "$($pkg.Id) installed."
            return
        }
        Write-Info "  $($pkg.Id) not available (exit $LASTEXITCODE), trying next..."
    }
    throw "could not auto-install Java $minVersion+. download from https://adoptium.net and re-run."
}

# Global: path to the java.exe that the rest of the script (and the dashboard) should use.
$script:JavaExe = $null

function Ensure-Java([int]$minVersion = 21) {
    Write-Step "checking Java (need $minVersion+)..."

    # Pass 1: what do we already have?
    $best = Find-BestJava $minVersion
    if ($best.Exe) {
        Write-Ok "Java $($best.Version) ready - $($best.Exe)"
        $script:JavaExe = $best.Exe
        return
    }

    # Nothing suitable. Install and re-scan.
    Write-Warn "no Java $minVersion+ installation found. installing..."
    Install-Java -minVersion $minVersion

    # Refresh PATH from registry - winget installer just wrote to it
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH","User") + ";" +
                $env:PATH

    # Pass 2: scan again
    $best = Find-BestJava $minVersion
    if (-not $best.Exe) {
        throw "Java $minVersion+ still not found after install. restart PowerShell and re-run."
    }
    Write-Ok "Java $($best.Version) ready - $($best.Exe)"
    $script:JavaExe = $best.Exe
}

# -- Version lists -------------------------------------------------------------
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

# -- Server download -----------------------------------------------------------
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
    $javaExe = if ($script:JavaExe) { $script:JavaExe } else { "java" }
    & $javaExe -jar "$dir\fabric-installer.jar" server -mcversion $version -downloadMinecraft -dir $dir
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

# -- Server config -------------------------------------------------------------
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

# -- Firewall ------------------------------------------------------------------
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

# -- Dashboard -----------------------------------------------------------------
function Install-Dashboard([string]$dir) {
    Write-Step "installing dashboard..."
    $base = "https://raw.githubusercontent.com/OutBlade/mineblade/main/dashboard"
    New-Item -ItemType Directory -Path "$dir\dashboard" -Force | Out-Null
    Download-File "$base/dashboard.py" "$dir\dashboard\dashboard.py"
    Download-File "$base/index.html" "$dir\dashboard\index.html"
    Write-Ok "dashboard installed."
}

function Stop-ExistingDashboard {
    # Kill anything still holding port 8080 - usually a dashboard from a previous run
    # with stale code. Also kill any orphaned java.exe running the minecraft server.
    # NOTE: cannot use $pid as a loop variable - it's a PowerShell automatic variable
    # containing the current process ID and assignment to it silently fails.
    try {
        $owners = @(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue |
                    Select-Object -ExpandProperty OwningProcess -Unique)
        foreach ($ownerPid in $owners) {
            try {
                $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
                $pname = if ($proc) { $proc.ProcessName } else { "unknown" }
                Write-Info "stopping old dashboard (PID $ownerPid, $pname)..."
                # Stop-Process fails with Zugriff verweigert if the target ran elevated;
                # fall back to taskkill which honours the current token better.
                Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
                if (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue) {
                    & taskkill /F /PID $ownerPid 2>&1 | Out-Null
                }
            } catch {}
        }
    } catch {}

    # Kill any java.exe started by an old dashboard for our server.jar
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'java.exe' -and $_.CommandLine -match 'mineblade-server.*server\.jar' } |
        ForEach-Object {
            $jpid = $_.ProcessId
            Write-Info "stopping orphaned server java.exe (PID $jpid)..."
            Stop-Process -Id $jpid -Force -ErrorAction SilentlyContinue
            if (Get-Process -Id $jpid -ErrorAction SilentlyContinue) {
                & taskkill /F /PID $jpid 2>&1 | Out-Null
            }
        }

    Start-Sleep -Milliseconds 500
}

function Start-Dashboard([string]$dir, [int]$ramMb) {
    Write-Step "starting dashboard at http://localhost:8080 ..."

    Stop-ExistingDashboard

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
    if ($script:JavaExe) { $env:MINEBLADE_JAVA_EXE = $script:JavaExe }
    Start-Process -FilePath $pythonCmd.Source -ArgumentList "`"$dir\dashboard\dashboard.py`"" `
        -WorkingDirectory $dir -WindowStyle Hidden
    Start-Sleep -Seconds 2
    Start-Process "http://localhost:8080"
    Write-Ok "dashboard started. browser opened."
}

# -- Port forwarding info ------------------------------------------------------
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

# -- Main ----------------------------------------------------------------------

# Refresh session PATH from registry - picks up apps installed after this session started.
# This is why java installed via winget is invisible until you restart PowerShell.
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("PATH","User") + ";" +
            $env:PATH

Write-Header

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

# Java - checked AFTER version selection so we know the exact requirement
$requiredJava = Get-RequiredJavaVersion $mcVersion
Ensure-Java -minVersion $requiredJava

# Persist the resolved Java path so the dashboard uses the exact same exe.
# This is more reliable than env var inheritance through Start-Process.
if ($script:JavaExe) {
    Set-Content -Path "$serverDir\java.txt" -Value $script:JavaExe -Encoding ASCII
}

# RAM
$totalRamMb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)
$suggestedRamMb = [math]::Min([math]::Max([math]::Round($totalRamMb / 2), 1024), 8192)
Write-Host ""
Write-Host "  RAM allocation (MB) - you have ${totalRamMb}MB total, suggested: ${suggestedRamMb}MB" -ForegroundColor DarkGray
$rawRam = Read-Host "    enter MB (or press Enter for $suggestedRamMb)"
if ([string]::IsNullOrWhiteSpace($rawRam)) { $ramMb = $suggestedRamMb } else { $ramMb = [int]$rawRam }

# Max players
$rawPlayers = Read-Host "  max players (Enter for 20)"
if ([string]::IsNullOrWhiteSpace($rawPlayers)) { $maxPlayers = 20 } else { $maxPlayers = [int]$rawPlayers }

# Clean old server/world data so a server-type switch doesn't cause crashes.
# Paper/Fabric can't load a level.dat created by Vanilla (and vice-versa).
$oldJar = Join-Path $serverDir "server.jar"
if (Test-Path $oldJar) {
    Write-Step "cleaning old server data..."
    foreach ($item in @("world", "world_nether", "world_the_end",
                        "server.jar", "level.dat", "session.lock",
                        "libraries", "versions", "bundler",
                        "fabric-server-launch.jar", "fabric-server-launcher.properties")) {
        $path = Join-Path $serverDir $item
        if (Test-Path $path) {
            Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
            Write-Info "removed $item"
        }
    }
}

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

# Start script for convenient re-launch without re-running setup
Write-Step "writing start script..."
$javaPath = if ($script:JavaExe) { $script:JavaExe } else { "java" }
$startBat = @"
@echo off
cd /d "%~dp0"
start "" "dashboard\dashboard.py"
timeout /t 2 /nobreak >nul
start http://localhost:8080
echo mineblade: dashboard opened at http://localhost:8080
echo press any key to close this window...
pause >nul
"@
Set-Content -Path "$serverDir\start.bat" -Value $startBat -Encoding ASCII
Write-Ok "start.bat written (double-click to launch)"

# Firewall
Open-Firewall

# Dashboard
Install-Dashboard $serverDir
Start-Dashboard $serverDir $ramMb

# Port forwarding
Show-PortForwardingInfo

Write-Host "  all done. manage your server at http://localhost:8080" -ForegroundColor Green
Write-Host "  to start again later, double-click start.bat in $serverDir" -ForegroundColor DarkGray
Write-Host ""
Read-Host "  Press Enter to close"
