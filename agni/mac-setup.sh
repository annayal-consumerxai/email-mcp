#!/usr/bin/env bash
# One-time Mac setup for the Agniverse email MCP.
#   bash ~/CUADING/email-mcp/agni/mac-setup.sh
# 1. takes the shared key + Google client from the Syncthing hand-off folder
# 2. installs and builds
# 3. signs in your mailboxes (a browser tab opens for each)
# 4. adds the server to Claude Code and the Claude desktop app
# 5. hands the encrypted sign-ins back to the VPS through Syncthing
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CUADING="$(cd "$REPO/.." && pwd)"
HANDOFF="$CUADING/.email-mcp-handoff"
CONF="$HOME/.email-mcp"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

command -v node >/dev/null || { echo "Node is not installed. Install Node 22+ (brew install node) and run this again."; exit 1; }
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 22 ] || { echo "Node $major found; email-mcp needs 22 or newer (brew upgrade node)."; exit 1; }

say "1/5  Shared key and Google client"
mkdir -p "$CONF" && chmod 700 "$CONF"
if [ -f "$HANDOFF/key" ]; then
  cp "$HANDOFF/key" "$CONF/key"
  cp "$HANDOFF/gmail-client.env" "$CONF/gmail-client.env"
  chmod 600 "$CONF/key" "$CONF/gmail-client.env"
  rm -f "$HANDOFF/key" "$HANDOFF/gmail-client.env"
  echo "Copied into $CONF and removed from the hand-off folder."
elif [ -f "$CONF/key" ]; then
  echo "Already in $CONF."
else
  echo "Not found in $HANDOFF yet. Wait for Syncthing to finish (a minute) and run again."; exit 1
fi

say "2/5  Install and build"
cd "$REPO"
npm ci --ignore-scripts --no-audit --no-fund
npm run build

say "3/5  Sign in your mailboxes"
cat <<'TXT'
For each mailbox: pick "Gmail", press Enter on the account name (or type a short
one like "an"), and approve in the browser tab that opens. Answer "y" to add
another until all four are done:
  an@agniverse.co   admin@agniverse.co   hello@agniverse.co   hello@gethandler.ai
If Google picks the wrong account, choose "Use another account".
TXT
bash "$REPO/agni/run.sh" setup --scope restricted
bash "$REPO/agni/run.sh" setup --list || true

say "4/5  Add to Claude"
if command -v claude >/dev/null; then
  claude mcp remove -s user email >/dev/null 2>&1 || true
  claude mcp add -s user email -- bash "$REPO/agni/run.sh" && echo "Added to Claude Code (user scope) as \"email\"."
else
  echo "claude CLI not found; skipped Claude Code."
fi
DESKTOP="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
if [ -d "$(dirname "$DESKTOP")" ]; then
  [ -f "$DESKTOP" ] && cp "$DESKTOP" "$DESKTOP.bak-$(date +%Y%m%d%H%M%S)"
  node -e '
    const fs = require("fs"); const [file, runner] = process.argv.slice(1);
    let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    cfg.mcpServers = cfg.mcpServers || {};
    cfg.mcpServers.email = { command: "bash", args: [runner] };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  ' "$DESKTOP" "$REPO/agni/run.sh"
  echo "Added to the Claude desktop app (restart it to load). Backup kept next to the config."
fi

say "5/5  Hand the sign-ins to the VPS"
mkdir -p "$HANDOFF"
cp "$CONF/credentials.enc" "$HANDOFF/credentials.enc"
echo "Copied the encrypted sign-ins to $HANDOFF; Syncthing carries them to the VPS,"
echo "and Claude there moves them into place and deletes the hand-off copy."
say "Done. Tell Claude: \"Mac setup done\"."
