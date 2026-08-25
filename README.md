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
- **Runtime safety** — defensive code by default, since a `TypeError` in a WebView blanks the screen instead of failing the build
- **Device automation** (`eitri-device` skill) — screenshot, tap, swipe, type, native tab switching, and live DOM / console inspection of the Eitri WebView, on Android (ADB + Chrome DevTools Protocol) and the iOS Simulator (idb + WebKit Inspector)

Each capability is a separate skill; `eitri-specialist` is the entry point and chains to the others.

## Repository structure

```
.claude-plugin/
  marketplace.json               # Marketplace definition (name: eitri-plugins)
plugins/eitri-coding/
  .claude-plugin/plugin.json     # Plugin metadata
  hooks/                         # Loads the specialist skill on coding prompts in an Eitri project
  skills/
    eitri-specialist/            # Entry point: project rules, routing, runtime safety
    eitri-luminus/               # Luminus UI component reference
    eitri-bifrost/               # Bifrost native API reference
    eitri-claude-design-migrate/ # Claude Design → Eitri porting
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
