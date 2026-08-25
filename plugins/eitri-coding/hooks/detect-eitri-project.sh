#!/usr/bin/env bash
# Injects the eitri-specialist instruction only when BOTH hold: the working
# directory is an Eitri project, and the user's prompt is actual work on it
# (implement / fix / review / run). Silent otherwise — the previous SessionStart
# version fired on every session and dragged the skill into unrelated tasks.
set -uo pipefail

command -v python3 >/dev/null 2>&1 || exit 0
exec python3 "$(dirname "${BASH_SOURCE[0]}")/detect-eitri-project.py"
