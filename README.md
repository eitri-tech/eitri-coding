# eitri-coding

Claude Code plugin that turns Claude into a Senior Eitri Expert Front-End Developer — builds mobile-first web apps with Luminus + Bifrost and interacts with Android devices via ADB.

## Requirements

- [Claude Code](https://claude.ai/code) CLI installed
- This repository published on GitHub at `eitri-tech/eitri-coding`

## Installation

### 1. Add the marketplace

```
/plugin marketplace add eitri-tech/eitri-coding
```

This registers the `eitri-plugins` marketplace from the GitHub repository.

### 2. Install the plugin

```
/plugin install eitri-coding@eitri-plugins
```

### 3. Activate the skill

Once installed, invoke the skill in any Claude Code session:

```
/eitri-coding
```

## What it does

When active, Claude operates as a Senior Eitri Expert Front-End Developer with knowledge of:

- **Luminus UI** — Eitri's component library (no raw HTML tags allowed)
- **Bifrost** — Eitri's native bridge for device capabilities
- **File-based routing** under `src/views/`
- **ADB automation** via `tools/android.py` for screenshot, tap, swipe, and text interaction on a connected Android device running EitriPlay

See [SKILL.md](./SKILL.md) for the full skill specification.

## Repository structure

```
.claude-plugin/
  marketplace.json   # Marketplace definition (name: eitri-plugins)
  plugin.json        # Plugin metadata
SKILL.md             # Skill prompt loaded by Claude
tools/
  android.py         # ADB helper script
```
