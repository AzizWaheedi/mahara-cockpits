#!/bin/bash
# Watchdog for the Tap Payments MCP HTTP server + its Cloudflare quick tunnel.
# Idempotent: does nothing if both are already up and healthy.
#
# Run via cron every few minutes so both survive crashes and VPS restarts
# without systemd/root, which are unavailable in this environment.
#
# NOTE ON THE TUNNEL: this uses `cloudflared tunnel --url` (an account-less
# "quick tunnel"). Its public *.trycloudflare.com URL is NOT stable across
# restarts — if the tunnel process dies and this script restarts it, the
# URL changes and every client's config needs updating. Fine for getting
# started; if this becomes a permanent dependency, move to a named
# Cloudflare Tunnel (needs a free Cloudflare account + `cloudflared tunnel
# login`) for a URL that never changes.

set -euo pipefail

APP_DIR="/opt/data/work_memcore/servers/tap-payments-mcp"
ENV_FILE="/opt/data/secrets/tap-payments-mcp.env"
LOG_FILE="/opt/data/secrets/tap-payments-mcp.log"
PID_FILE="/opt/data/secrets/tap-payments-mcp.pid"
PORT=8420

CLOUDFLARED_BIN="/opt/data/bin/cloudflared"
TUNNEL_LOG="/opt/data/secrets/cloudflared.log"
TUNNEL_PID_FILE="/opt/data/secrets/cloudflared.pid"
TUNNEL_URL_FILE="/opt/data/secrets/tap-mcp-public-url.txt"

# --- 1. Ensure the Tap server itself is up ---------------------------------
if ! curl -sf --max-time 3 "http://localhost:${PORT}/health" > /dev/null 2>&1; then
  if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      echo "$(date -Iseconds) tap-payments-mcp: pid $OLD_PID alive but not healthy, leaving it (investigate manually)" >> "$LOG_FILE"
    fi
  fi

  cd "$APP_DIR"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  nohup node dist/http.js >> "$LOG_FILE" 2>&1 &
  NEW_PID=$!
  echo "$NEW_PID" > "$PID_FILE"
  echo "$(date -Iseconds) tap-payments-mcp: started, pid $NEW_PID" >> "$LOG_FILE"

  sleep 2
  if curl -sf --max-time 3 "http://localhost:${PORT}/health" > /dev/null 2>&1; then
    echo "$(date -Iseconds) tap-payments-mcp: confirmed healthy after restart" >> "$LOG_FILE"
  else
    echo "$(date -Iseconds) tap-payments-mcp: FAILED to come up after restart, check $LOG_FILE" >> "$LOG_FILE"
    exit 1
  fi
fi

# --- 2. Ensure the Cloudflare tunnel is up ----------------------------------
TUNNEL_ALIVE=false
if [ -f "$TUNNEL_PID_FILE" ]; then
  TUNNEL_PID=$(cat "$TUNNEL_PID_FILE" 2>/dev/null || echo "")
  if [ -n "$TUNNEL_PID" ] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    TUNNEL_ALIVE=true
  fi
fi

if [ "$TUNNEL_ALIVE" = false ]; then
  # Rotate the tunnel log on every restart so grepping it for a URL can
  # never pick up a stale URL from a previous run.
  if [ -f "$TUNNEL_LOG" ]; then
    mv "$TUNNEL_LOG" "${TUNNEL_LOG}.$(date +%s).old" 2>/dev/null || true
  fi

  nohup "$CLOUDFLARED_BIN" tunnel --url "http://localhost:${PORT}" --logfile "$TUNNEL_LOG" >> "$TUNNEL_LOG" 2>&1 &
  NEW_TUNNEL_PID=$!
  echo "$NEW_TUNNEL_PID" > "$TUNNEL_PID_FILE"
  echo "$(date -Iseconds) tap-payments-mcp: cloudflared started, pid $NEW_TUNNEL_PID (URL will change - watch $TUNNEL_URL_FILE)" >> "$LOG_FILE"

  # Give it up to 15s to negotiate and print the new URL in the FRESH log.
  URL=""
  for _ in $(seq 1 15); do
    sleep 1
    URL=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" "$TUNNEL_LOG" 2>/dev/null | tail -1 || true)
    if [ -n "$URL" ]; then
      break
    fi
  done

  if [ -n "$URL" ]; then
    echo "$URL" > "$TUNNEL_URL_FILE"
    echo "$(date -Iseconds) tap-payments-mcp: new public URL $URL" >> "$LOG_FILE"
  else
    echo "$(date -Iseconds) tap-payments-mcp: cloudflared started but no URL appeared in 15s, check $TUNNEL_LOG" >> "$LOG_FILE"
    exit 1
  fi
fi

