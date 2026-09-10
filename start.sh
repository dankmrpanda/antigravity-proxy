#!/usr/bin/env bash
# Antigravity Proxy — macOS / Linux launcher
#
# Usage: ./start.sh [--port 8443] [--background]
# Requires: Node.js 20+, npm
# Runs attached by default: logs to the terminal, Ctrl+C stops everything.
# Use --background to detach (logs to a file instead).
# Port 443 requires root/sudo. Use --port 8443 + pfctl forwarding to avoid
# running the whole proxy as root (see "Port forwarding" section below).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY_DIR="$SCRIPT_DIR/proxy"
OS="$(uname -s)"

# ── Resolve the real user when run under sudo ─────────────────────────────────
# sudo resets $HOME to /var/root, which would send certs/config/logs to the
# wrong home (dashboard unreachable, root-owned files). It would also launch
# the browser and Antigravity as root (wrong profile → looks like logout).
# So every user-scoped path uses REAL_HOME, and GUI/file ops run as REAL_USER.
REAL_USER="${SUDO_USER:-$(whoami)}"
REAL_HOME="$HOME"
if [[ -n "${SUDO_USER:-}" ]]; then
  REAL_HOME="$(eval echo "~$SUDO_USER")"
  [[ -n "$REAL_HOME" && -d "$REAL_HOME" ]] || REAL_HOME="$HOME"
fi
USER_DATA_DIR="$REAL_HOME/.antigravity"
USER_ENV_FILE="$USER_DATA_DIR/.env"
USER_CERT_FILE="$USER_DATA_DIR/certs/cert.pem"

# Run a command as the real (non-root) user when we are root.
as_user() {
  if [[ $EUID -eq 0 && "$REAL_USER" != "root" ]]; then
    sudo -u "$REAL_USER" "$@"
  else
    "$@"
  fi
}

# ── Colour helpers ────────────────────────────────────────────────────────────
info()  { echo "  [INFO]  $*"; }
ok()    { echo "  [ OK ]  $*"; }
warn()  { echo "  [WARN]  $*" >&2; }
err()   { echo "  [ERR]   $*" >&2; }
step()  { echo; echo "==> $*"; }

# ── Parse args ────────────────────────────────────────────────────────────────
PROXY_PORT=""
BACKGROUND=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port|-p) PROXY_PORT="$2"; shift 2 ;;
    --background|-b) BACKGROUND=1; shift ;;
    --foreground|-f) BACKGROUND=0; shift ;; # accepted for compat; foreground is the default
    --help|-h)
      echo "Usage: ./start.sh [--port 8443] [--background]"
      echo "  --port 8443     Use high port (no sudo needed for bind; requires 443→8443 forwarding for intercept)"
      echo "  --background    Detach into the background (logs to a file). Default is attached:"
      echo "                  logs to the terminal, Ctrl+C stops the proxy."
      exit 0 ;;
    *) shift ;;
  esac
done

# ── Prerequisites ─────────────────────────────────────────────────────────────
step "Checking prerequisites"
if ! command -v node &>/dev/null; then
  err "Node.js not found. Install from https://nodejs.org or via your package manager."
  err "  macOS:  brew install node"
  err "  Ubuntu: sudo apt install nodejs npm"
  exit 1
fi
NODE_VER=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  err "Node.js 20+ required (found v$NODE_VER)"
  exit 1
fi
ok "Node.js v$NODE_VER ($OS)"
NODE_BIN="$(command -v node)"

if ! command -v npm &>/dev/null; then
  err "npm not found."
  exit 1
fi

# ── Fix ~/.antigravity ownership (sudo-created, root-owned) ──────────────────
# Running with sudo used to create root-owned files in ~/.antigravity, which
# then breaks non-sudo runs with EACCES. Detect and offer the one-time fix.
# (New runs keep everything owned by REAL_USER, so this should rarely trigger.)
if [[ -d "$USER_DATA_DIR" ]] && [[ ! -w "$USER_DATA_DIR" ]]; then
  warn "$USER_DATA_DIR is not writable (likely root-owned from a previous sudo run)."
  warn "Fix once with: sudo chown -R $REAL_USER $USER_DATA_DIR"
fi

# ── npm install (as the real user — never root-own node_modules) ──────────────
if [[ ! -d "$PROXY_DIR" ]]; then
  err "Proxy directory not found: $PROXY_DIR"
  exit 1
fi
cd "$PROXY_DIR"
step "Installing dependencies"
if [[ ! -d node_modules ]]; then
  as_user npm install
  ok "Dependencies installed"
else
  ok "Dependencies already installed (delete node_modules to reinstall)"
fi

# ── Build TypeScript if dist/ missing (so `node dist/` works without tsx) ────
if [[ ! -f "$PROXY_DIR/dist/index.js" ]]; then
  step "Building TypeScript"
  if as_user npx tsc 2>/dev/null; then
    ok "TypeScript compiled to dist/"
  else
    warn "Build failed — will run via tsx (dev mode) instead"
  fi
else
  ok "Build output ready (dist/ exists)"
fi

# ── TLS certificates (owned by the real user) ─────────────────────────────────
# gen-certs.mjs writes to BOTH proxy/certs/ (repo/CI) and ~/.antigravity/certs/
# (runtime). The proxy prefers the user dir with fallback to the repo dir.
step "Checking TLS certificates"
if [[ ! -f "$USER_CERT_FILE" && ! -f "$PROXY_DIR/certs/cert.pem" ]]; then
  step "Generating TLS certificates"
  as_user env HOME="$REAL_HOME" node scripts/gen-certs.mjs
  if [[ $EUID -eq 0 ]]; then
    chown -R "$REAL_USER" "$REAL_HOME/.antigravity/certs" "$PROXY_DIR/certs" 2>/dev/null || true
  fi
  ok "Certificates generated"
else
  ok "Certificates exist"
fi
# Resolve the active cert file for the trust step below
if [[ -f "$USER_CERT_FILE" ]]; then
  CERT_FILE="$USER_CERT_FILE"
else
  CERT_FILE="$PROXY_DIR/certs/cert.pem"
fi

# ── Trust the certificate ─────────────────────────────────────────────────────
step "Trusting TLS certificate"
if [[ "$OS" == "Darwin" ]]; then
  # Match by SHA-1 fingerprint (robust); "localhost" CN alone is too broad.
  CERT_SHA1=$(openssl x509 -in "$CERT_FILE" -noout -fingerprint -sha1 2>/dev/null | sed 's/.*=//;s/://g' || true)
  if [[ -n "${CERT_SHA1:-}" ]] && security find-certificate -a -Z /Library/Keychains/System.keychain 2>/dev/null | tr -d ' \n' | grep -qi "$CERT_SHA1"; then
    ok "Certificate already trusted (macOS System keychain)"
  else
    info "Adding certificate to macOS System Keychain (may prompt for password)..."
    if sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CERT_FILE" 2>/dev/null; then
      ok "Certificate added to macOS System Keychain"
    else
      warn "Could not auto-trust certificate. To trust manually:"
      warn "  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain '$CERT_FILE'"
      warn "Or open Keychain Access, import cert.pem into System, and set to 'Always Trust'."
    fi
  fi
elif [[ "$OS" == "Linux" ]]; then
  # Linux: varies by distro — best-effort
  if command -v update-ca-certificates &>/dev/null; then
    TRUST_DIR="/usr/local/share/ca-certificates"
    if [[ -d "$TRUST_DIR" ]]; then
      if sudo cp "$CERT_FILE" "$TRUST_DIR/antigravity-proxy.crt" 2>/dev/null && sudo update-ca-certificates 2>/dev/null; then
        ok "Certificate trusted via update-ca-certificates"
      else
        warn "Could not auto-trust certificate."
        warn "  To trust manually: sudo cp '$CERT_FILE' /usr/local/share/ca-certificates/antigravity-proxy.crt && sudo update-ca-certificates"
      fi
    fi
  elif command -v trust &>/dev/null; then
    if sudo trust anchor --store "$CERT_FILE" 2>/dev/null; then
      ok "Certificate trusted via trust anchor"
    else
      warn "Could not auto-trust certificate. Run: sudo trust anchor --store '$CERT_FILE'"
    fi
  else
    warn "Cannot auto-trust certificate on this Linux system."
    warn "Add the certificate to your browser's trusted CAs manually:"
    warn "  Chrome: Settings → Privacy → Manage certificates → Authorities → Import"
    warn "  Firefox: Settings → Privacy → View Certificates → Authorities → Import"
  fi
else
  warn "Unknown OS: $OS — skipping certificate trust step."
fi

# ── Hosts file (route Google domains → 127.0.0.1) ─────────────────────────────
# Without this, Antigravity traffic never reaches the proxy. The CLI
# (antigravity start) does this automatically; start.sh must too.
step "Configuring hosts file"
HOSTS_FILE="/etc/hosts"
HOSTS_MARKER="# Antigravity Proxy"
HOSTS_ENTRIES=(
  "127.0.0.1 cloudcode-pa.googleapis.com"
  "127.0.0.1 daily-cloudcode-pa.googleapis.com"
  "127.0.0.1 runtime.us-east-1.kiro.dev"
  "127.0.0.1 kiro.dev"
  "127.0.0.1 app.kiro.dev"
)
HOSTS_MISSING=()
for entry in "${HOSTS_ENTRIES[@]}"; do
  domain="${entry##* }"
  if ! grep -qE "^[^#]*${domain}" "$HOSTS_FILE" 2>/dev/null; then
    HOSTS_MISSING+=("$entry")
  fi
done
if [[ ${#HOSTS_MISSING[@]} -eq 0 ]]; then
  ok "Hosts file already configured"
else
  info "Adding ${#HOSTS_MISSING[@]} routing entr(ies) to $HOSTS_FILE (may prompt for password)..."
  HOSTS_TMP="$(mktemp)"
  cp "$HOSTS_FILE" "$HOSTS_TMP"
  if ! grep -q "$HOSTS_MARKER" "$HOSTS_TMP"; then
    printf '\n%s\n' "$HOSTS_MARKER" >> "$HOSTS_TMP"
  fi
  for entry in "${HOSTS_MISSING[@]}"; do
    printf '%s\n' "$entry" >> "$HOSTS_TMP"
  done
  if sudo cp "$HOSTS_TMP" "$HOSTS_FILE" 2>/dev/null; then
    ok "Hosts file configured"
  else
    warn "Could not update hosts file. Re-run with sudo, or add manually:"
    for entry in "${HOSTS_MISSING[@]}"; do warn "  $entry"; done
  fi
  rm -f "$HOSTS_TMP"
fi

# ── Kill old proxy (LISTENERS ONLY) ────────────────────────────────────────────
# NOTE: plain `lsof -ti tcp:443` matches every socket using 443 as either
# endpoint — including outbound HTTPS from browsers and Antigravity itself.
# Killing those PIDs kills innocent apps. -sTCP:LISTEN restricts to processes
# actually bound on the port (i.e. a previous proxy instance).
step "Checking for old proxy processes"
PORTS_TO_CHECK=(443 8443 4000)
if [[ -n "$PROXY_PORT" ]]; then
  PORTS_TO_CHECK=("${PORTS_TO_CHECK[@]}" "$PROXY_PORT")
fi
# LISTEN sockets only (see NOTE above). Echoes PIDs or nothing.
pids_on_port() {
  local port="$1"
  if command -v lsof &>/dev/null; then
    lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true
  elif command -v ss &>/dev/null; then
    # ss output parsing (Linux fallback); -oP not portable so use grep/sed
    ss -tlnp 2>/dev/null | grep ":$port " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' || true
  fi
}
for PORT in "${PORTS_TO_CHECK[@]}"; do
  PIDS="$(pids_on_port "$PORT")"
  if [[ -n "${PIDS:-}" ]]; then
    info "Stopping process(es) on port $PORT (PIDs: $PIDS)"
    # shellcheck disable=SC2086
    echo $PIDS | xargs kill -TERM 2>/dev/null || true
    sleep 1
    # A previous sudo run leaves ROOT-owned listeners that an unprivileged
    # kill cannot touch (silently). If anything survives, retry elevated —
    # otherwise the stale instance keeps the ports and shadows the new one.
    REMAIN="$(pids_on_port "$PORT")"
    if [[ -n "${REMAIN:-}" && $EUID -ne 0 ]]; then
      info "Port $PORT still held (root-owned?) — retrying with sudo..."
      # shellcheck disable=SC2086
      echo $REMAIN | xargs sudo kill -TERM 2>/dev/null || true
      sleep 1
      REMAIN="$(pids_on_port "$PORT")"
    fi
    if [[ -n "${REMAIN:-}" ]]; then
      warn "Port $PORT still held by: $REMAIN — the new proxy may fail to bind."
    fi
  fi
done
ok "Port check complete"

# ── Port binding decision ─────────────────────────────────────────────────────
EFFECTIVE_PORT="${PROXY_PORT:-443}"
if [[ "$EFFECTIVE_PORT" -lt 1024 && $EUID -ne 0 ]]; then
  warn "Not running as root. Port $EFFECTIVE_PORT may fail with EACCES."
  warn "Options:"
  warn "  1. Run with sudo:    sudo ./start.sh"
  warn "  2. Use a high port:  ./start.sh --port 8443"
  warn "     + forward 443→8443 so Antigravity (which dials 443) still hits the proxy:"
  if [[ "$OS" == "Darwin" ]]; then
    warn "       echo 'rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port 8443' | sudo pfctl -ef -"
  else
    warn "       sudo iptables -t nat -A OUTPUT -p tcp -d 127.0.0.1 --dport 443 -j REDIRECT --to-port 8443"
  fi
  warn ""
  warn "Continuing anyway — if port $EFFECTIVE_PORT fails, set PROXY_PORT=8443 in your .env"
fi

# ── Create .env from example if missing ──────────────────────────────────────
# Config lives in ~/.antigravity/.env (migrated from proxy/.env on first run).
# start.sh keeps proxy/.env as the source of truth for port overrides below,
# and the proxy migrates it to the user dir automatically at startup.
if [[ ! -f "$PROXY_DIR/.env" ]]; then
  if [[ -f "$USER_ENV_FILE" ]]; then
    ok "Using existing config at $USER_ENV_FILE"
  elif [[ -f "$PROXY_DIR/.env.example" ]]; then
    step "Creating proxy/.env from template"
    cp "$PROXY_DIR/.env.example" "$PROXY_DIR/.env"
    warn "Created proxy/.env — add your API keys before using the proxy."
    warn "Open http://localhost:4000 → Config tab to configure providers."
  fi
fi

# ── Set port override if passed ───────────────────────────────────────────────
# Portable in-place edit: macOS (BSD) sed needs an explicit backup suffix,
# GNU sed accepts -i without one. Use a .bak file on both, then remove it.
if [[ -n "$PROXY_PORT" ]]; then
  ENV_TARGET="$PROXY_DIR/.env"
  if [[ ! -f "$ENV_TARGET" && -f "$PROXY_DIR/.env.example" ]]; then
    cp "$PROXY_DIR/.env.example" "$ENV_TARGET"
  fi
  if grep -q "^PROXY_PORT=" "$ENV_TARGET" 2>/dev/null; then
    sed -i.bak "s/^PROXY_PORT=.*/PROXY_PORT=$PROXY_PORT/" "$ENV_TARGET" && rm -f "$ENV_TARGET.bak"
  else
    echo "PROXY_PORT=$PROXY_PORT" >> "$ENV_TARGET"
  fi
  info "PROXY_PORT set to $PROXY_PORT in proxy/.env"
  # Also mirror into the active user config so the running proxy picks it up
  # even when ~/.antigravity/.env already exists (config.ts reads user dir).
  if [[ -f "$USER_ENV_FILE" ]]; then
    if grep -q "^PROXY_PORT=" "$USER_ENV_FILE" 2>/dev/null; then
      sed -i.bak "s/^PROXY_PORT=.*/PROXY_PORT=$PROXY_PORT/" "$USER_ENV_FILE" && rm -f "$USER_ENV_FILE.bak"
    else
      echo "PROXY_PORT=$PROXY_PORT" >> "$USER_ENV_FILE"
    fi
    info "PROXY_PORT mirrored to $USER_ENV_FILE"
  fi
fi

# ── Create logs dir (real user's dir; legacy proxy/logs as fallback) ──────────
as_user mkdir -p "$USER_DATA_DIR/logs" 2>/dev/null || mkdir -p "$PROXY_DIR/logs"
LOG_DIR="$USER_DATA_DIR/logs"
[[ -d "$LOG_DIR" ]] || LOG_DIR="$PROXY_DIR/logs"

# ── Start proxy ───────────────────────────────────────────────────────────────
step "Starting proxy"
LOG_FILE="$LOG_DIR/proxy_$(date +%Y%m%d_%H%M%S).log"

# Prefer compiled dist/ when available (no tsx needed); fall back to tsx src/.
if [[ -f "$PROXY_DIR/dist/index.js" ]]; then
  ENTRY_ARGS=("$PROXY_DIR/dist/index.js")
  USE_TSX=0
else
  ENTRY_ARGS=(--import tsx/esm "$PROXY_DIR/src/index.ts")
  USE_TSX=1
fi
if [[ "$USE_TSX" -eq 1 && ! -d "$PROXY_DIR/node_modules/tsx" && ! -d "$PROXY_DIR/node_modules/.bin/tsx" ]]; then
  warn "tsx not found but dist/ missing — installing dev dependencies for tsx..."
  npm install 2>/dev/null || true
fi

# ── Attached mode (default): proxy replaces this shell ──────────────────────
# Logs stream to the terminal; Ctrl+C (or closing the terminal) stops the
# proxy with it. Browser + Antigravity are opened via a short delayed
# one-shot so they launch once the proxy is up.
if [[ "$BACKGROUND" -eq 0 ]]; then
  info "Running attached (Ctrl+C to stop)..."
  API_PORT_HINT=$(grep -E "^API_PORT=" "$PROXY_DIR/.env" 2>/dev/null | cut -d= -f2 | cut -d'#' -f1 | tr -d '[:space:]' || echo "4000")
  API_PORT_HINT="${API_PORT_HINT:-4000}"
  (sleep 6
   if [[ "$OS" == "Darwin" ]]; then
     as_user open "http://localhost:${API_PORT_HINT}" 2>/dev/null || true
     [[ -d "/Applications/Antigravity.app" ]] && as_user open "/Applications/Antigravity.app" 2>/dev/null || true
   elif command -v xdg-open &>/dev/null; then
     as_user xdg-open "http://localhost:${API_PORT_HINT}" 2>/dev/null || true
   fi) & disown 2>/dev/null || true
  if [[ "$EFFECTIVE_PORT" -lt 1024 && $EUID -ne 0 ]]; then
    info "Requesting sudo for privileged port $EFFECTIVE_PORT..."
    exec sudo HOME="$REAL_HOME" "$NODE_BIN" "${ENTRY_ARGS[@]}"
  else
    # Already root (or high port): keep HOME on the real user so config/certs
    # resolve to their ~/.antigravity, not /var/root/.antigravity.
    exec env HOME="$REAL_HOME" "$NODE_BIN" "${ENTRY_ARGS[@]}"
  fi
fi

# Background mode (opt-in via --background)
if [[ "$EFFECTIVE_PORT" -lt 1024 && $EUID -ne 0 ]]; then
  # Preflight: the background sudo below cannot prompt for a password, so
  # validate/cache credentials NOW while we still have the terminal.
  # Without this, a failed background sudo leaves ports answered by a STALE
  # instance while start.sh reports success (the health check passes against
  # the old process and every later step silently targets it).
  if ! sudo -v; then
    err "sudo authentication failed — cannot bind privileged port $EFFECTIVE_PORT in background."
    err "Run 'sudo -v' first, run attached (default, sudo prompts inline), or use ./start.sh --port 8443."
    exit 1
  fi
  info "Requesting sudo to bind privileged port $EFFECTIVE_PORT..."
  nohup sudo HOME="$REAL_HOME" "$NODE_BIN" "${ENTRY_ARGS[@]}" > "$LOG_FILE" 2>&1 &
else
  nohup env HOME="$REAL_HOME" "$NODE_BIN" "${ENTRY_ARGS[@]}" > "$LOG_FILE" 2>&1 &
fi
PROXY_PID=$!
ok "Proxy starting (PID $PROXY_PID) — log: $LOG_FILE"
# Files created while root must go back to the real user, or later non-sudo
# runs fail with EACCES.
if [[ $EUID -eq 0 && "$REAL_USER" != "root" ]]; then
  chown "$REAL_USER" "$LOG_FILE" 2>/dev/null || true
  chown -R "$REAL_USER" "$USER_DATA_DIR" 2>/dev/null || true
fi

# ── Wait for dashboard ────────────────────────────────────────────────────────
step "Waiting for dashboard..."
API_PORT=$(grep -E "^API_PORT=" "$PROXY_DIR/.env" 2>/dev/null | cut -d= -f2 | cut -d'#' -f1 | tr -d '[:space:]' || echo "4000")
API_PORT="${API_PORT:-4000}"
HTTP_STATUS="000"
for _i in $(seq 1 20); do
  if command -v curl &>/dev/null; then
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${API_PORT}/api/health" 2>/dev/null || echo "000")
  else
    HTTP_STATUS=$(nc -z localhost "$API_PORT" 2>/dev/null && echo "200" || echo "000")
  fi
  if [[ "$HTTP_STATUS" == "200" ]]; then
    ok "Dashboard ready at http://localhost:${API_PORT}"
    break
  fi
  sleep 0.5
done
if [[ "$HTTP_STATUS" != "200" ]]; then
  warn "Dashboard not yet responding — check log: $LOG_FILE"
fi

# ── Open browser (as the real user — never root) ──────────────────────────────
step "Opening dashboard"
if [[ "$OS" == "Darwin" ]]; then
  as_user open "http://localhost:${API_PORT}" 2>/dev/null || true
elif command -v xdg-open &>/dev/null; then
  as_user xdg-open "http://localhost:${API_PORT}" 2>/dev/null || true
elif command -v gnome-open &>/dev/null; then
  as_user gnome-open "http://localhost:${API_PORT}" 2>/dev/null || true
else
  info "Open http://localhost:${API_PORT} in your browser."
fi

# ── Launch Antigravity (as the real user — never root) ────────────────────────
# A root-launched Electron app creates root-owned profile data, locking the
# user out on next normal launch (looks like being logged out).
step "Launching Antigravity"
ANTIGRAVITY_APP=""
if [[ "$OS" == "Darwin" ]]; then
  if [[ -d "/Applications/Antigravity.app" ]]; then
    ANTIGRAVITY_APP="/Applications/Antigravity.app"
  elif [[ -d "$REAL_HOME/Applications/Antigravity.app" ]]; then
    ANTIGRAVITY_APP="$REAL_HOME/Applications/Antigravity.app"
  fi
  if [[ -n "$ANTIGRAVITY_APP" ]]; then
    as_user open "$ANTIGRAVITY_APP" 2>/dev/null || true
    ok "Antigravity launched as $REAL_USER"
  else
    info "Antigravity.app not found — launch it manually."
  fi
elif command -v antigravity &>/dev/null; then
  ANTIGRAVITY_APP="$(command -v antigravity)"
  as_user open "$ANTIGRAVITY_APP" 2>/dev/null || as_user "$ANTIGRAVITY_APP" 2>/dev/null || true
  ok "Antigravity launched as $REAL_USER"
else
  info "Antigravity not found on PATH — launch it manually."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
step "Ready!"
info "  Dashboard:  http://localhost:${API_PORT}"
info "  TLS Proxy:  https://localhost:${EFFECTIVE_PORT}"
info "  Log file:   $LOG_FILE"
info "  User data:  $USER_DATA_DIR (owned by $REAL_USER)"
info ""
info "  Configure providers and API keys from the dashboard Config tab."
info "  To stop: kill $PROXY_PID  (attached mode instead: just Ctrl+C)"
info ""
info "  To run attached instead of detached (logs to terminal):"
info "    ./start.sh   (this is the default; --background detaches)"
