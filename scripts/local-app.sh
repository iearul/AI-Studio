#!/bin/bash
# Runs AI Studio as a macOS LaunchAgent: a production build that starts at
# login and is restarted by launchd whenever the API or web server exits.
#
# Usage: scripts/local-app.sh install|update|start|stop|restart|status|logs|uninstall
set -euo pipefail

LABEL="com.iearul.ai-studio"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/AI-Studio"
LOG_FILE="$LOG_DIR/app.log"
# Port 3000 is often taken by other local projects.
WEB_PORT=3100
WEB_URL="http://localhost:$WEB_PORT"
WEB_STANDALONE="$ROOT/apps/web/.next/standalone/apps/web"
DOMAIN="gui/$(id -u)"

# launchd starts jobs with a minimal PATH; node and pnpm come from Homebrew.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

build() {
  cd "$ROOT"
  pnpm install --frozen-lockfile
  pnpm build
}

run() {
  mkdir -p "$LOG_DIR"
  if [[ -f "$LOG_FILE" && $(stat -f %z "$LOG_FILE") -gt 10485760 ]]; then
    mv "$LOG_FILE" "$LOG_FILE.1"
  fi
  exec >>"$LOG_FILE" 2>&1
  echo "--- $(date '+%Y-%m-%d %H:%M:%S') starting AI Studio"

  cd "$ROOT"
  if [[ ! -f apps/api/dist/server.js || ! -f "$WEB_STANDALONE/server.js" ]]; then
    build
  fi
  # The standalone Next.js server only serves assets copied next to it.
  rsync -a --delete apps/web/.next/static/ "$WEB_STANDALONE/.next/static/"
  if [[ -d apps/web/public ]]; then
    rsync -a --delete apps/web/public/ "$WEB_STANDALONE/public/"
  fi

  export NODE_ENV=production
  export WEB_ORIGIN="$WEB_URL,http://127.0.0.1:$WEB_PORT"
  node apps/api/dist/server.js &
  local api=$!
  PORT="$WEB_PORT" HOSTNAME=127.0.0.1 node "$WEB_STANDALONE/server.js" &
  local web=$!

  trap 'kill "$api" "$web" 2>/dev/null; wait; exit 0' TERM INT
  # macOS ships bash 3.2 without `wait -n`, so poll both servers instead.
  while kill -0 "$api" 2>/dev/null && kill -0 "$web" 2>/dev/null; do
    sleep 2
  done
  echo "--- $(date '+%Y-%m-%d %H:%M:%S') a server exited; launchd will restart"
  kill "$api" "$web" 2>/dev/null || true
  wait || true
  exit 1
}

write_plist() {
  mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/scripts/local-app.sh</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>15</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/launchd.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/launchd.log</string>
</dict>
</plist>
EOF
}

loaded() {
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1
}

start() {
  if loaded; then
    launchctl kickstart -k "$DOMAIN/$LABEL"
  else
    launchctl bootstrap "$DOMAIN" "$PLIST"
  fi
  echo "AI Studio is starting at $WEB_URL"
}

stop() {
  if loaded; then launchctl bootout "$DOMAIN/$LABEL"; fi
  echo "AI Studio stopped. It starts again at next login or with 'start'."
}

status() {
  if ! loaded; then
    echo "LaunchAgent is not loaded."
    return
  fi
  launchctl print "$DOMAIN/$LABEL" | grep -E '^\s+(state|pid|last exit code) ='
  if curl -fsS --max-time 3 http://127.0.0.1:4100/api/v1/health >/dev/null; then
    echo "API: up"
  else
    echo "API: down"
  fi
  if curl -fsS --max-time 3 -o /dev/null "$WEB_URL"; then
    echo "Web: up at $WEB_URL"
  else
    echo "Web: down"
  fi
}

case "${1:-}" in
  install)
    build
    write_plist
    stop >/dev/null
    start
    ;;
  update)
    build
    start
    ;;
  start) start ;;
  stop) stop ;;
  restart) start ;;
  status) status ;;
  logs) tail -n 100 -f "$LOG_FILE" ;;
  uninstall)
    stop >/dev/null
    rm -f "$PLIST"
    echo "AI Studio LaunchAgent removed. Logs remain in $LOG_DIR."
    ;;
  run) run ;;
  *)
    echo "Usage: $0 install|update|start|stop|restart|status|logs|uninstall" >&2
    exit 64
    ;;
esac
