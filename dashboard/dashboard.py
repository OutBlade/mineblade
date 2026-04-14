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

SERVER_DIR = os.environ.get("MINEBLADE_SERVER_DIR", os.path.dirname(os.path.abspath(__file__)) + "/..")
RAM_MB     = int(os.environ.get("MINEBLADE_RAM_MB", 2048))
PORT       = 8080

server_process = None
log_lines      = []
log_lock       = threading.Lock()

# ── Process management ────────────────────────────────────────────────────────

def _read_output(proc):
    for raw in proc.stdout:
        line = raw.decode("utf-8", errors="replace").rstrip()
        with log_lock:
            log_lines.append(line)
            if len(log_lines) > 600:
                log_lines.pop(0)

def start_server():
    global server_process
    if server_process and server_process.poll() is None:
        return {"ok": False, "error": "already running"}

    jar = os.path.join(SERVER_DIR, "server.jar")
    if not os.path.isfile(jar):
        return {"ok": False, "error": "server.jar not found in " + SERVER_DIR}

    _log("[mineblade] starting server...")
    server_process = subprocess.Popen(
        ["java", f"-Xmx{RAM_MB}m", f"-Xms{min(RAM_MB, 1024)}m",
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
    return {"running": running, "players": players, "ram_mb": RAM_MB, "server_dir": SERVER_DIR}

# ── HTTP handler ──────────────────────────────────────────────────────────────

DASH_DIR = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # suppress request logs

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
