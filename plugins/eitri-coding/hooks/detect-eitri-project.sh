#!/usr/bin/env bash
# Detects an Eitri project in the working directory and injects a mandatory
# instruction to load the eitri-specialist skill. Silent when not an Eitri project.
set -uo pipefail

cwd="${CLAUDE_PROJECT_DIR:-$PWD}"

found=""
for f in "$cwd/eitri-app.conf.js" "$cwd/app-config.yaml"; do
  [ -f "$f" ] && found="$found$(basename "$f") "
done

if [ -z "$found" ]; then
  nested=$(find "$cwd" -maxdepth 2 \
    \( -name eitri-app.conf.js -o -name app-config.yaml \) \
    -not -path '*/node_modules/*' 2>/dev/null | head -5)
  [ -n "$nested" ] && found=$(printf '%s' "$nested" | tr '\n' ' ')
fi

[ -z "$found" ] && exit 0

kind="single Eitri-App (eitri start)"
case "$found" in
  *app-config.yaml*) kind="multi-app Eitri workspace (eitri app start)" ;;
esac

context="EITRI PROJECT DETECTED — found: ${found% }.
This working directory is an Eitri project: ${kind}.
MANDATORY: before writing, editing, running or reviewing ANY code here, invoke the \`eitri-coding:eitri-specialist\` skill and follow its rules for the rest of the session. Do not apply generic React / web / React Native practice — Eitri projects use Luminus components (no raw HTML tags), Bifrost APIs (no fetch/localStorage/navigator), and file-based routing under src/views/. This applies even if the user never mentions Eitri."

# JSON-escape via python if available, else fall back to plain stdout.
if command -v python3 >/dev/null 2>&1; then
  CTX="$context" python3 -c '
import json, os
print(json.dumps({"hookSpecificOutput": {
    "hookEventName": os.environ.get("HOOK_EVENT", "SessionStart"),
    "additionalContext": os.environ["CTX"],
}}))'
else
  printf '%s\n' "$context"
fi
