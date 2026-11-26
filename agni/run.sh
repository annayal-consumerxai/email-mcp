#!/usr/bin/env bash
# Starts the email MCP server the Agniverse way: our Google client, the shared
# credential key, drafts-only mode on. Same script on the Mac and the VPS.
# Secrets live outside the repo in ~/.email-mcp (mode 600), never in git.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="$HOME/.email-mcp"

set -a
# shellcheck disable=SC1091
. "$CONF/gmail-client.env"
set +a
EMAIL_MCP_KEY="$(cat "$CONF/key")"
export EMAIL_MCP_KEY
export EMAIL_MCP_DRAFT_ONLY="${EMAIL_MCP_DRAFT_ONLY:-1}"

if [ "${1:-}" = "setup" ]; then
  shift
  exec node "$DIR/dist/setup/wizard.js" "$@"
fi
exec node "$DIR/dist/index.js"
