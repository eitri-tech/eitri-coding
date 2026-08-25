import json, os, re, sys
from pathlib import Path

try:
    payload = json.load(sys.stdin)
except Exception:
    payload = {}

prompt = (payload.get("prompt") or "").strip()
if not prompt:
    sys.exit(0)

cwd = Path(payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())

# One injection per session: after the skill is loaded its rules already apply
# for the rest of the session, so repeating this is noise.
session = payload.get("session_id") or "nosession"
stamp = Path(os.environ.get("TMPDIR", "/tmp")) / f"eitri-specialist-{session}.flag"
if stamp.exists():
    sys.exit(0)

WORK = re.compile(
    r"""\b(
      eitri|eitri-?app|eitri-?play|luminus|bifrost|forge|
      implementa\w*|cria\w*|adicion\w*|escrev\w*|desenvolv\w*|constr[óo]\w*|gera\w*|
      ajust\w*|corrig\w*|conserta\w*|arrum\w*|refator\w*|altera\w*|mud[ae]\w*|
      remov\w*|delet\w*|renomei\w*|migra\w*|integra\w*|
      revis\w*|analis\w*|investiga\w*|debug\w*|depura\w*|
      test\w*|rod[ae]\w*|executa\w*|inicia\w*|sobe|subir|abre|abrir|
      compila\w*|builda\w*|deploy\w*|publica\w*|
      tela|telas|view|views|componente\w*|p[áa]gina\w*|layout|estilo|rota\w*|
      bug|erro\w*|crash\w*|quebr\w*|falha\w*|
      implement\w*|creat\w*|add|adding|writ\w*|build\w*|
      fix\w*|updat\w*|chang\w*|edit\w*|refactor\w*|migrat\w*|
      review\w*|analyz\w*|analys\w*|inspect\w*|
      run|start|launch|screenshot|render\w*|
      screen|component\w*|page|route\w*|style\w*
    )\b""",
    re.IGNORECASE | re.VERBOSE,
)
CODE_REF = re.compile(r"\.(tsx?|jsx?)\b|src/views/|eitri-app\.conf\.js|app-config\.ya?ml")

if not (WORK.search(prompt) or CODE_REF.search(prompt)):
    sys.exit(0)

roots = [p for p in ("eitri-app.conf.js", "app-config.yaml") if (cwd / p).is_file()]
nested = []
if not roots:
    for child in sorted(cwd.iterdir()) if cwd.is_dir() else []:
        if not child.is_dir() or child.name in {"node_modules", ".git"}:
            continue
        for name in ("eitri-app.conf.js", "app-config.yaml"):
            if (child / name).is_file():
                nested.append(f"{child.name}/{name}")
if not roots and not nested:
    sys.exit(0)

found = roots or nested
workspace = any("app-config" in f for f in found)
kind = (
    "multi-app Eitri workspace (dev server: `eitri app start`)"
    if workspace
    else "single Eitri-App (dev server: `eitri start`)"
)

lines = [
    f"EITRI PROJECT DETECTED — found: {', '.join(found)}.",
    f"This working directory is a {kind}.",
    "MANDATORY for this task: invoke the `eitri-coding:eitri-specialist` skill before writing, editing, running or reviewing code here, and follow its rules for the rest of the session. Do not apply generic React / web / React Native practice — Eitri uses Luminus components (no raw HTML tags), Bifrost APIs (no fetch/localStorage/navigator), file-based routing under src/views/, and demands defensive code against null remote data.",
]
if nested:
    lines.append(
        "The Eitri app(s) live in subdirectories, not at the root: "
        + ", ".join(nested)
        + ". Run Eitri commands from the right directory and confirm which app the user means before assuming."
    )

try:
    stamp.write_text("1")
except Exception:
    pass

print(json.dumps({"hookSpecificOutput": {
    "hookEventName": payload.get("hook_event_name") or "UserPromptSubmit",
    "additionalContext": "\n".join(lines),
}}))
