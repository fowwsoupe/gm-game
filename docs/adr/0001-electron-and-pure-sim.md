# 0001: Electron wrapper, pure TypeScript sim, SQLite saves

Status: accepted

## Context

GM games are mostly tables, menus and charts, so a web UI stack (React, Tailwind,
TanStack) fits well and matches what we already know. It needs a desktop wrapper for Steam.

## Decision

- **Electron**, not Tauri. Electron bundles Chromium, so the game renders the same on every
  machine, and `steamworks.js` supports it including the overlay. Tauri uses the OS webview
  (three engines to test) and the Steam overlay doesn't hook into WebView2.
- **Sim as a pure TypeScript package** with a seeded RNG, run in a worker thread.
- **One SQLite file per save** (better-sqlite3). Easy Steam Cloud sync, fast stat queries.
- **ML trained offline in Python, shipped as ONNX.** Rules-based sim stays as the core;
  models replace specific pieces behind interfaces like `GoalModel`.

## Consequences

- Bigger download (~100 MB+) than Tauri. Acceptable for a Steam game.
- Native modules (`better-sqlite3`, `steamworks.js`) must be rebuilt for Electron:
  `electron-builder install-app-deps` runs on install.
- Test builds on Windows early; most Steam players are on Windows.
