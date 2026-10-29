# eitri-coding

Claude Code plugin that turns Claude into a Senior Eitri Expert Front-End Developer — builds mobile-first web apps with Luminus + Bifrost and drives them on real Android devices and iOS simulators.

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

### 3. Log in to the Eitri Manager MCP

The plugin ships the Eitri Manager MCP server (`https://api.eitri.tech/eitri-manager-mcp/mcp`). Run `/mcp` in Claude Code, select `plugin:eitri-coding:eitri-manager`, and complete the browser login once.

### 4. Use it

Skills load on their own. In an Eitri project (`eitri-app.conf.js` or `app-config.yaml`), a SessionStart hook makes Claude load `eitri-specialist` automatically. To call it by hand:

```
/eitri-coding:eitri-specialist
```

## Updating

Third-party marketplaces don't auto-update by default, so you get new versions in one of two ways:

- **Manually**: `/plugin marketplace update eitri-plugins`, then `/plugin update eitri-coding@eitri-plugins` (or `claude plugin update eitri-coding@eitri-plugins` from the shell). Run `/reload-plugins` or restart.
- **Automatically**: `/plugin` → **Marketplaces** → `eitri-plugins` → **Enable auto-update**.

For a team repo, commit this to `.claude/settings.json` so every collaborator gets the marketplace, the plugin and auto-update:

```json
{
  "extraKnownMarketplaces": {
    "eitri-plugins": {
      "source": { "source": "github", "repo": "eitri-tech/eitri-coding" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": { "eitri-coding@eitri-plugins": true }
}
```

Maintainers: `plugin.json` pins `version`, so users only receive a release when that string changes. Bump it in every release PR.

## What it does

When active, Claude operates as a Senior Eitri Expert Front-End Developer with knowledge of:

- **Luminus UI** — Eitri's component library (no raw HTML tags allowed)
- **Bifrost** — Eitri's native bridge for device capabilities
- **File-based routing** under `src/views/`
- **Runtime safety** — defensive code by default, since a `TypeError` in a WebView blanks the screen instead of failing the build
- **Eitri Manager MCP** — bundled remote MCP server for managing your Eitri apps (OAuth login via `/mcp`)
- **Site cloning** (`site-clone` skill) — captures a live URL with Playwright and rebuilds it in the project's framework (Eitri, FastStore, or generic React). Needs Node.js; first run installs Playwright and Chromium
- **Device automation** (`eitri-device` skill) — screenshot, tap, swipe, type, native tab switching, and live DOM / console inspection of the Eitri WebView, on Android (ADB + Chrome DevTools Protocol) and the iOS Simulator (idb + WebKit Inspector)

Each capability is a separate skill; `eitri-specialist` is the entry point and chains to the others.

## Repository structure

```
.claude-plugin/
  marketplace.json               # Marketplace definition (name: eitri-plugins)
plugins/eitri-coding/
  .claude-plugin/plugin.json     # Plugin metadata
  .mcp.json                      # Eitri Manager MCP server
  hooks/                         # Loads the specialist skill on coding prompts in an Eitri project
  skills/
    eitri-specialist/            # Entry point: project rules, routing, runtime safety
    eitri-luminus/               # Luminus UI component reference
    eitri-bifrost/               # Bifrost native API reference
    eitri-shopping/              # Eitri Shopping bundles (multi-app e-commerce)
    eitri-typescript-migrate/    # JS→TS migration for an existing Eitri-App workspace
    eitri-claude-design-migrate/ # Claude Design → Eitri porting
    site-clone/                  # Live website → rebuild in the project's framework
      scripts/                   # Playwright capture (scrape.mjs) and screenshot (shot.mjs)
      references/                # Rebuild loop + per-framework adapters
    eitri-device/                # Device & simulator automation
      tools/
        android.py               # ADB + Chrome DevTools Protocol
        ios.py                   # idb + WebKit Inspector (macOS)
        webinspect.py            # Shared injected JS / WebView inspection
```

## License

Licensed under the [Apache License 2.0](./LICENSE).

```
Copyright 2026 Eitri
```
