#!/usr/bin/env python3
"""
mineblade dashboard — local web UI for managing your Minecraft server
https://github.com/OutBlade/mineblade
"""

import http.server
import socketserver
import subprocess
import threading
import json
import os
import re
import sys

SERVER_DIR = os.environ.get("MINEBLADE_SERVER_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
RAM_MB     = int(os.environ.get("MINEBLADE_RAM_MB", 2048))
PORT       = 8080

server_process = None
last_error     = None
log_lines      = []
log_lock       = threading.Lock()

# ── Java discovery ────────────────────────────────────────────────────────────

def _java_version(exe):
    """Return the major version int of a java executable, or 0 on failure."""
    try:
        r = subprocess.run([exe, "-version"], capture_output=True, text=True, timeout=5)
        m = re.search(r'"(\d+)', r.stderr + r.stdout)
        return int(m.group(1)) if m else 0
    except Exception:
        return 0

def find_best_java():
    """Return the path to the highest-version java.exe available."""
    # 1. Explicit pin written by setup.ps1 - most reliable
    pin_file = os.path.join(SERVER_DIR, "java.txt")
    if os.path.isfile(pin_file):
        try:
            with open(pin_file, "r", encoding="utf-8") as f:
                pinned = f.read().strip()
            if pinned and os.path.isfile(pinned):
                return pinned
        except Exception:
            pass

    # 2. Env var fallback (less reliable across Start-Process boundaries)
    from_env = os.environ.get("MINEBLADE_JAVA_EXE", "")
    if from_env and os.path.isfile(from_env):
        return from_env

    best_exe     = None
    best_version = 0

    candidates = []

    if sys.platform == "win32":
        import winreg

        # Read system PATH from registry (picks up installs done after session start)
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                                r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment") as k:
                sys_path, _ = winreg.QueryValueEx(k, "Path")
            for p in sys_path.split(";"):
                j = os.path.join(p, "java.exe")
                if os.path.isfile(j):
                    candidates.append(j)
        except Exception:
            pass

        # Scan JDK registry keys written by installers
        reg_roots = [
            r"SOFTWARE\Eclipse Adoptium\JDK",
            r"SOFTWARE\Eclipse Foundation\JDK",
            r"SOFTWARE\AdoptOpenJDK\JDK",
            r"SOFTWARE\Microsoft\JDK",
            r"SOFTWARE\JavaSoft\JDK",
        ]
        for key_path in reg_roots:
            try:
                with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key_path) as key:
                    i = 0
                    while True:
                        try:
                            ver_name = winreg.EnumKey(key, i)
                            i += 1
                            msi_path = fr"{key_path}\{ver_name}\hotspot\MSI"
                            try:
                                with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, msi_path) as msi:
                                    install_path, _ = winreg.QueryValueEx(msi, "Path")
                                    j = os.path.join(install_path.rstrip("\\"), "bin", "java.exe")
                                    if os.path.isfile(j):
                                        candidates.append(j)
                            except OSError:
                                pass
                        except OSError:
                            break
            except OSError:
                pass
    else:
        # Mac / Linux: check JAVA_HOME and common paths
        java_home = os.environ.get("JAVA_HOME", "")
        if java_home:
            candidates.append(os.path.join(java_home, "bin", "java"))
        for p in ["/usr/bin/java", "/usr/local/bin/java"]:
            if os.path.isfile(p):
                candidates.append(p)

    # Score every candidate and pick the highest version
    seen = set()
    for j in candidates:
        real = os.path.realpath(j)
        if real in seen:
            continue
        seen.add(real)
        v = _java_version(j)
        if v > best_version:
            best_version = v
            best_exe = j

    return best_exe or "java"

# ── Process management ────────────────────────────────────────────────────────

def _read_output(proc):
    global server_process, last_error
    for raw in proc.stdout:
        line = raw.decode("utf-8", errors="replace").rstrip()
        with log_lock:
            log_lines.append(line)
            if len(log_lines) > 600:
                log_lines.pop(0)

        # Detect Java version mismatch and stop immediately — don't keep retrying
        if "UnsupportedClassVersionError" in line:
            m = re.search(r"class file version (\d+)", line)
            needed = (int(m.group(1)) - 44) if m else "newer"
            msg = (f"[mineblade] Java is too old for this server. "
                   f"Need Java {needed}+. Download from https://adoptium.net")
            _log(msg)
            last_error = msg
            proc.kill()
            server_process = None
            return

def start_server():
    global server_process, last_error
    if server_process and server_process.poll() is None:
        return {"ok": False, "error": "already running"}

    jar = os.path.join(SERVER_DIR, "server.jar")
    if not os.path.isfile(jar):
        return {"ok": False, "error": "server.jar not found in " + SERVER_DIR}

    last_error = None
    java_exe = find_best_java()
    java_ver = _java_version(java_exe)
    _log(f"[mineblade] starting server with Java {java_ver} ({java_exe})...")

    server_process = subprocess.Popen(
        [java_exe, f"-Xmx{RAM_MB}m", f"-Xms{min(RAM_MB, 1024)}m",
         "-jar", jar, "--nogui"],
        cwd=SERVER_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.PIPE
    )
    t = threading.Thread(target=_read_output, args=(server_process,), daemon=True)
    t.start()
    return {"ok": True}

def stop_server():
    global server_process
    if not server_process or server_process.poll() is not None:
        return {"ok": False, "error": "not running"}
    _log("[mineblade] stopping server...")
    try:
        server_process.stdin.write(b"stop\n")
        server_process.stdin.flush()
        server_process.wait(timeout=30)
    except Exception:
        server_process.kill()
    server_process = None
    return {"ok": True}

def _log(msg):
    with log_lock:
        log_lines.append(msg)

def get_status():
    running = server_process is not None and server_process.poll() is None
    players = 0
    if running:
        with log_lock:
            recent = list(log_lines[-60:])
        for line in reversed(recent):
            m = re.search(r"There are (\d+) of a max", line)
            if m:
                players = int(m.group(1))
                break
    return {
        "running":    running,
        "players":    players,
        "ram_mb":     RAM_MB,
        "server_dir": SERVER_DIR,
        "error":      last_error,
    }

# ── HTTP handler ──────────────────────────────────────────────────────────────

DASH_DIR = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            self._serve_file(os.path.join(DASH_DIR, "index.html"), "text/html")
        elif path == "/api/status":
            self._json(get_status())
        elif path == "/api/logs":
            with log_lock:
                lines = list(log_lines[-120:])
            self._json({"logs": lines})
        elif path == "/api/start":
            self._json(start_server())
        elif path == "/api/stop":
            self._json(stop_server())
        else:
            self.send_response(404)
            self.end_headers()

    def _serve_file(self, path, content_type):
        try:
            with open(path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()

    def _json(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

# ── Entry ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    _log(f"[mineblade] dashboard starting on http://localhost:{PORT}")
    _log(f"[mineblade] server dir: {SERVER_DIR}  ram: {RAM_MB}MB")
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"mineblade dashboard: http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            stop_server()
            print("\nshutdown.")
