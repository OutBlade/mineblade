#!/usr/bin/env bash
set -euo pipefail

# ── mineblade — instant Minecraft server setup (Mac / Linux)
# https://github.com/OutBlade/mineblade

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step()  { echo -e "  ${BOLD}>${NC} $1"; }
info()  { echo -e "  ${DIM}$1${NC}"; }
ok()    { echo -e "  ${GREEN}ok${NC}  $1"; }
warn()  { echo -e "  ${YELLOW}!!${NC}  $1"; }
fail()  { echo -e "  ${RED}xx${NC}  $1"; exit 1; }

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "mac" ;;
    Linux)  echo "linux" ;;
    *)      echo "unknown" ;;
  esac
}

OS=$(detect_os)

print_header() {
  clear
  echo ""
  echo -e "  ${BOLD}MINEBLADE${NC}"
  echo -e "  ${DIM}free minecraft server, on your machine${NC}"
  echo ""
}

prompt_choice() {
  local question="$1"; shift
  local options=("$@")
  echo ""
  echo -e "  $question"
  for i in "${!options[@]}"; do
    echo -e "  ${DIM}$((i+1)). ${options[$i]}${NC}"
  done
  while true; do
    read -rp "    choice: " raw
    if [[ "$raw" =~ ^[0-9]+$ ]] && (( raw >= 1 && raw <= ${#options[@]} )); then
      CHOICE=$((raw - 1))
      return
    fi
    warn "enter a number between 1 and ${#options[@]}"
  done
}

download_file() {
  local url="$1" dest="$2"
  info "downloading $(basename "$dest")..."
  if command -v curl &>/dev/null; then
    curl -sSL "$url" -o "$dest"
  else
    wget -q "$url" -O "$dest"
  fi
}

# ── Java ──────────────────────────────────────────────────────────────────────
java_major_version() {
  java -version 2>&1 | head -1 | grep -oP '"\K\d+' | head -1
}

install_java() {
  warn "installing Java..."
  if [[ "$OS" == "mac" ]]; then
    if command -v brew &>/dev/null; then
      brew install --quiet openjdk || fail "brew install openjdk failed."
      local prefix; prefix="$(brew --prefix)/opt/openjdk/libexec/openjdk.jdk"
      sudo ln -sfn "$prefix" /Library/Java/JavaVirtualMachines/openjdk.jdk 2>/dev/null || true
    else
      fail "Homebrew not found. Install it from https://brew.sh then re-run."
    fi
  elif [[ "$OS" == "linux" ]]; then
    if command -v apt-get &>/dev/null; then
      sudo apt-get update -qq && sudo apt-get install -y -qq default-jdk
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y java-latest-openjdk 2>/dev/null || sudo dnf install -y java-21-openjdk
    elif command -v pacman &>/dev/null; then
      sudo pacman -S --noconfirm jdk-openjdk
    else
      fail "Unknown package manager. Install Java 21+ from https://adoptium.net and re-run."
    fi
  fi
  command -v java &>/dev/null || fail "Java installation failed. Install manually from https://adoptium.net"
  ok "Java installed."
}

ensure_java() {
  step "checking Java..."
  if command -v java &>/dev/null; then
    local major; major=$(java_major_version)
    if [[ -n "$major" ]] && (( major >= 21 )); then
      ok "Java $major found."
      return
    elif [[ -n "$major" ]]; then
      warn "Java $major is too old (need 21+). upgrading..."
      install_java
    else
      warn "Java found but version unreadable. continuing..."
    fi
  else
    warn "Java not found."
    install_java
  fi
  local major; major=$(java_major_version)
  ok "Java $major ready."
}

# ── Version lists ─────────────────────────────────────────────────────────────
get_vanilla_versions() {
  curl -sSL "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json" \
    | python3 -c "
import json,sys
data=json.load(sys.stdin)
releases=[v['id'] for v in data['versions'] if v['type']=='release'][:8]
print('\n'.join(releases))
"
}

get_paper_versions() {
  curl -sSL "https://api.papermc.io/v2/projects/paper" \
    | python3 -c "
import json,sys
data=json.load(sys.stdin)
versions=data['versions'][-8:]
print('\n'.join(versions))
"
}

get_fabric_versions() {
  curl -sSL "https://meta.fabricmc.net/v2/versions/game" \
    | python3 -c "
import json,sys
data=json.load(sys.stdin)
stable=[v['version'] for v in data if v['stable']][:8]
print('\n'.join(stable))
"
}

# ── Downloads ─────────────────────────────────────────────────────────────────
download_vanilla() {
  local version="$1" dir="$2"
  local meta_url
  meta_url=$(curl -sSL "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json" \
    | python3 -c "
import json,sys
data=json.load(sys.stdin)
v=next(x for x in data['versions'] if x['id']=='$version')
print(v['url'])
")
  local server_url
  server_url=$(curl -sSL "$meta_url" | python3 -c "import json,sys; print(json.load(sys.stdin)['downloads']['server']['url'])")
  download_file "$server_url" "$dir/server.jar"
}

download_paper() {
  local version="$1" dir="$2"
  local build jar url
  build=$(curl -sSL "https://api.papermc.io/v2/projects/paper/versions/$version/builds" \
    | python3 -c "import json,sys; builds=json.load(sys.stdin)['builds']; print(builds[-1]['build'])")
  jar=$(curl -sSL "https://api.papermc.io/v2/projects/paper/versions/$version/builds/$build" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['downloads']['application']['name'])")
  url="https://api.papermc.io/v2/projects/paper/versions/$version/builds/$build/downloads/$jar"
  download_file "$url" "$dir/server.jar"
}

download_fabric() {
  local version="$1" dir="$2"
  local installer_url
  installer_url=$(curl -sSL "https://meta.fabricmc.net/v2/versions/installer" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['url'])")
  download_file "$installer_url" "$dir/fabric-installer.jar"
  info "running Fabric installer for $version..."
  java -jar "$dir/fabric-installer.jar" server -mcversion "$version" -downloadMinecraft -dir "$dir"
  rm -f "$dir/fabric-installer.jar"
  if [[ -f "$dir/fabric-server-launch.jar" ]]; then
    cp "$dir/fabric-server-launch.jar" "$dir/server.jar"
  fi
}

download_forge() {
  warn "Forge auto-install is not supported yet."
  info "Download the Forge installer from https://files.minecraftforge.net"
  info "Place the server jar in: $SERVER_DIR"
  info "Rename it to server.jar, then run the dashboard."
  read -rp "  Press Enter to continue..."
}

# ── Config ────────────────────────────────────────────────────────────────────
write_server_config() {
  local dir="$1" max_players="$2"
  echo "eula=true" > "$dir/eula.txt"
  cat > "$dir/server.properties" <<EOF
server-port=25565
max-players=$max_players
difficulty=normal
gamemode=survival
online-mode=true
enable-rcon=false
motd=mineblade server
EOF
  ok "server.properties written."
}

# ── Dashboard ─────────────────────────────────────────────────────────────────
install_dashboard() {
  local dir="$1"
  step "installing dashboard..."
  mkdir -p "$dir/dashboard"
  local base="https://raw.githubusercontent.com/OutBlade/mineblade/main/dashboard"
  download_file "$base/dashboard.py"  "$dir/dashboard/dashboard.py"
  download_file "$base/index.html"    "$dir/dashboard/index.html"
  chmod +x "$dir/dashboard/dashboard.py"
  ok "dashboard installed."
}

start_dashboard() {
  local dir="$1" ram_mb="$2"
  step "starting dashboard at http://localhost:8080 ..."
  local py
  py=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || echo "")
  if [[ -z "$py" ]]; then
    warn "Python not found. Install Python 3 and re-run, or start manually:"
    info "  java -Xmx${ram_mb}m -jar $dir/server.jar --nogui"
    return
  fi
  export MINEBLADE_SERVER_DIR="$dir"
  export MINEBLADE_RAM_MB="$ram_mb"
  nohup "$py" "$dir/dashboard/dashboard.py" > "$dir/dashboard.log" 2>&1 &
  sleep 2
  if [[ "$OS" == "mac" ]]; then
    open "http://localhost:8080"
  else
    xdg-open "http://localhost:8080" 2>/dev/null || true
  fi
  ok "dashboard started. browser opened."
}

# ── Port forwarding ───────────────────────────────────────────────────────────
show_port_forwarding() {
  echo ""
  echo -e "  ${BOLD}PORT FORWARDING${NC}"
  echo -e "  ${DIM}to let friends outside your network join:${NC}"
  echo ""
  echo -e "  ${DIM}1. find your router IP (usually 192.168.1.1 or 192.168.0.1)${NC}"
  echo -e "  ${DIM}2. log in and find 'Port Forwarding'${NC}"
  echo -e "  ${DIM}3. forward TCP port 25565 to this machine's local IP${NC}"
  echo ""
  local local_ip
  if [[ "$OS" == "mac" ]]; then
    local_ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "unknown")
  else
    local_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")
  fi
  echo -e "    your local IP: ${BOLD}$local_ip${NC}"
  echo -e "  ${DIM}  your public IP: check https://whatismyipaddress.com${NC}"
  echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────────
print_header
ensure_java

SERVER_DIR="$HOME/mineblade-server"
mkdir -p "$SERVER_DIR"
ok "server folder: $SERVER_DIR"

prompt_choice "server type:" "Vanilla (official Mojang)" "Paper (performance)" "Fabric (mod loader)" "Forge (mod loader)"
TYPE_IDX=$CHOICE

step "fetching available versions..."
case $TYPE_IDX in
  0) mapfile -t VERSIONS < <(get_vanilla_versions) ;;
  1) mapfile -t VERSIONS < <(get_paper_versions) ;;
  2) mapfile -t VERSIONS < <(get_fabric_versions) ;;
  3) mapfile -t VERSIONS < <(get_vanilla_versions) ;;
esac

prompt_choice "Minecraft version:" "${VERSIONS[@]}"
MC_VERSION="${VERSIONS[$CHOICE]}"

# RAM
TOTAL_KB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1024)}' || echo 4194304)
TOTAL_MB=$((TOTAL_KB / 1024))
SUGGESTED_MB=$(( TOTAL_MB / 2 ))
(( SUGGESTED_MB < 1024 )) && SUGGESTED_MB=1024
(( SUGGESTED_MB > 8192 )) && SUGGESTED_MB=8192
echo ""
echo -e "  ${DIM}RAM allocation (MB) — you have ${TOTAL_MB}MB total, suggested: ${SUGGESTED_MB}MB${NC}"
read -rp "    enter MB (or press Enter for $SUGGESTED_MB): " RAW_RAM
RAM_MB=${RAW_RAM:-$SUGGESTED_MB}

read -rp "  max players (Enter for 20): " RAW_PLAYERS
MAX_PLAYERS=${RAW_PLAYERS:-20}

step "downloading $MC_VERSION server..."
case $TYPE_IDX in
  0) download_vanilla "$MC_VERSION" "$SERVER_DIR" ;;
  1) download_paper   "$MC_VERSION" "$SERVER_DIR" ;;
  2) download_fabric  "$MC_VERSION" "$SERVER_DIR" ;;
  3) download_forge   "$MC_VERSION" "$SERVER_DIR" ;;
esac
ok "server downloaded."

write_server_config "$SERVER_DIR" "$MAX_PLAYERS"
install_dashboard "$SERVER_DIR"
start_dashboard "$SERVER_DIR" "$RAM_MB"
show_port_forwarding

echo -e "  ${GREEN}all done.${NC} manage your server at http://localhost:8080"
echo ""
