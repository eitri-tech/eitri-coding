#!/usr/bin/env bash
# Entry point for the shared-library awareness hooks (SessionStart / PostToolUse / Stop).
# Delegates to the eitri-shared-bump script, which reads the hook payload from stdin and
# prints the hook JSON. Always silent and non-failing: awareness must never block work
# because of a missing node, no network, or a repo that is not an Eitri project.
set -uo pipefail

command -v node >/dev/null 2>&1 || exit 0

script="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}/skills/eitri-shared-bump/scripts/shared-changes.mjs"
[ -f "$script" ] || exit 0

exec node "$script" --hook "${HOOK_EVENT:-SessionStart}" 2>/dev/null || exit 0
