# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project shape

`obsidian-obsibooks` is an Obsidian community plugin (TypeScript, desktop-only). It is a **thin driver** around the [`obsibooks`](https://github.com/flochrislas/obsibooks) Python CLI: the plugin handles UI inside Obsidian, the CLI does all the actual conversion. The plugin never imports Python or any conversion logic — it spawns the CLI via `child_process` and renders the streamed log.

Architectural rationale and full design history live in `DEV_NOTES.md`; the short version: pure-TS port isn't viable because `pymupdf4llm` (the heavy lifter for PDF→markdown chapter structure) has no JS equivalent. Shell-out is precedented in the community store (Shell Commands, Python Scripter, Pandoc Reference List).

## Layout

| File | Purpose |
|---|---|
| `manifest.json` | Plugin metadata. `isDesktopOnly: true` — must stay true (shell-out has no mobile counterpart). `id` and `version` ship to the community store. |
| `versions.json` | `version → minAppVersion` map. Update whenever bumping `minAppVersion`. |
| `main.ts` | `Plugin` subclass. Loads settings, registers the settings tab, registers the one command `obsibooks:convert`. Wires PickerModal → runner → LogModal. |
| `runner.ts` | CLI detection (`which`/`where` + `--version` probe), pandoc detection, `child_process.spawn` driver with line-split stdout/stderr. The only non-trivial module. |
| `settings.ts` | `ObsibooksSettings` interface, `DEFAULT_SETTINGS`, and `ObsibooksSettingsTab` (three sections: CLI installation, default output, default compression). Includes the auto-download button that fetches the matching `obsibooks-<os>` asset from the obsibooks repo's latest GitHub release. |
| `modals/PickerModal.ts` | Pre-conversion form: single-file / folder radio, native picker via hidden `<input type="file">`, output subfolder, Overwrite + Compress toggles. |
| `modals/LogModal.ts` | Live conversion log: streaming `<pre>`, Cancel button, Close + *Open output* on success. *Open output* finds the newest `00 - *.md` under the output subfolder and opens it. |
| `styles.css` | Status colours, picked-path label, log box. |
| `esbuild.config.mjs`, `tsconfig.json`, `package.json` | Standard `obsidian-sample-plugin` scaffold. |

## Running

```bash
npm install
npm run dev      # esbuild watch — rebuilds main.js on save
npm run build    # production: tsc --noEmit then minified main.js
```

The bundled output (`main.js`) plus `manifest.json` and `styles.css` are the three files that ship to a vault. To test locally:

```bash
# symlink (or copy) the three files into a test vault
ln -s "$(pwd)/main.js"        <vault>/.obsidian/plugins/obsibooks/main.js
ln -s "$(pwd)/manifest.json"  <vault>/.obsidian/plugins/obsibooks/manifest.json
ln -s "$(pwd)/styles.css"     <vault>/.obsidian/plugins/obsibooks/styles.css
```

Then enable in *Settings → Community plugins*. Hot-reload plugin (e.g. via the [Hot Reload](https://github.com/pjeby/hot-reload) plugin) for fast iteration.

## External requirements (for the user, not for building)

The plugin doesn't bundle anything Python. The user needs:
- The **obsibooks CLI** somewhere the plugin can find it (PATH / custom path / a downloaded standalone binary).
- **Pandoc** on PATH, for EPUB conversion (PDF runs work without it).

The settings tab probes both and shows live status.

## Contract with the Python CLI

The only two CLI behaviors this plugin depends on. Treat them as a public API:

```
obsibooks --version
  → stdout contains "obsibooks <semver>", exit 0

obsibooks <path> -d <dir> [--overwrite]
                          [--compress --max-kb N --max-width N --max-height N --quality N]
  → progress + batch report on stdout/stderr, exit 0 on success
```

If you add new flags on the Python side, update PickerModal/runner together. If you ever remove `--version`, CLI detection breaks.

## Architecture

### Lifecycle

`Plugin.onload()` →
1. `loadSettings()` — merge defaults with `loadData()`.
2. `addSettingTab(new ObsibooksSettingsTab(...))`.
3. `addCommand({ id: 'convert', ... })` — single command in the palette.

`onunload()` has nothing to release; child processes only live as long as their LogModal.

### Conversion flow

```
command palette
  └─ main.openPicker()
       └─ PickerModal (single/folder, output subfolder, overwrite, compress)
            └─ onRun callback → main.runFromPicker(result)
                 ├─ runner.detectObsibooks(settings)   ← honours cliMode order
                 ├─ FileSystemAdapter.getBasePath() + result.outputSubfolder
                 ├─ runner.runConversion(cliPath, opts) ← spawns child_process
                 └─ new LogModal(controller, subfolder) ← streams RunEvents
```

`runner.runConversion` returns a `RunController { onEvent, kill, finished }`. The LogModal subscribes via `onEvent`, the Cancel button calls `kill`, the *Open output* button waits via `finished`.

### CLI detection priority

`detectObsibooks` honours `settings.cliMode`:
1. `custom` → use `settings.customCliPath` directly.
2. `binary` → use `settings.binaryPath` directly.
3. `auto` → resolve `obsibooks` via `where` (Windows) or `which` (Unix), use the first hit.

Each candidate runs `<candidate> --version` with a 3 s timeout and must produce a matching `obsibooks <semver>` line on stdout/stderr.

### Settings persistence

Standard Obsidian pattern: `Plugin.loadData()` / `saveData()`, JSON-serialised to `<vault>/.obsidian/plugins/obsibooks/data.json`. `DEFAULT_SETTINGS` is merged in at load time so adding new fields stays backwards-compatible.

## Key design decisions

- **`child_process.spawn` with `shell: false`.** The conversion args include user-provided absolute paths; `shell: true` would expose shell-injection risk. PATH resolution is handled by an explicit `which`/`where` probe before spawning, so we always invoke an absolute path.
- **Native picker via hidden `<input type="file">`.** Obsidian doesn't expose an OS file picker through its API. Electron exposes `File.path` on input elements for absolute paths. Folder mode uses `webkitdirectory` and derives the directory via `path.dirname(files[0].path)`. Slightly wasteful (the browser enumerates every file in the chosen folder) but works without a `@electron/remote` dependency.
- **Line-buffered events from the runner.** stdout and stderr are accumulated in a pending buffer and split on `\n`; only complete lines are emitted to the LogModal. Avoids tearing in mid-line CR/LF on Windows.
- **`titleEl` is in the `Modal` base class — don't shadow it.** Use `this.titleEl.setText(...)` directly. The previous draft tried to add a private getter named `titleEl` and TypeScript refused.
- **Auto-download writes to the plugin data dir.** `<vault>/.obsidian/plugins/obsibooks/obsibooks-<os>`. Plugin storage is the right place because the binary is per-vault-config and gets cleaned up when the plugin is uninstalled. Path is resolved via `FileSystemAdapter.getBasePath()` + `app.vault.configDir` + `plugins/<id>`.
- **`requestUrl` for both the GitHub API call and the asset download.** It handles HTTPS redirects through GitHub's CDN. For very large binaries (~100 MB+) this is slow with no progress UI — acceptable for v1.

## Common gotchas

- **`File.path` is an Electron extension.** Won't compile-error if you remove the cast, but runtime returns undefined in non-Electron contexts. The cast `(files[0] as unknown as { path: string }).path` documents that this is Electron-only and matches `isDesktopOnly: true`.
- **`tag` convention differs between the two repos.** Python repo: `v0.1.0`. Plugin repo: `0.1.0` (no `v`, per Obsidian community-plugin convention). Don't mix them up.
- **Settings tab calls `display()` to redraw on dropdown changes.** If you add async logic that updates UI state, schedule a `this.display()` after the state change.
- **`pyproject.toml` version is dynamic** — sourced from `obsibooks.__version__` in the Python module. Bump the constant, not the toml.

## Where things live across repos

| Thing | Where |
|---|---|
| Conversion logic | `obsibooks` repo (Python) — `obsibooks.py`, `pepub.py`, `pepdf.py`, `compress_images.py` |
| Plugin UI + spawn glue | This repo |
| Settings persistence | `<test-vault>/.obsidian/plugins/obsibooks/data.json` |
| Release artifacts | GitHub releases of each repo independently. Plugin pulls binaries from the `obsibooks` repo's latest release. |
| Release playbook + status | `DEV_NOTES.md` (this repo) |
| Original consolidation plan | `C:/Users/flore/.claude/plans/vast-chasing-ritchie.md` |

## Public entry points to call from new code

| Symbol | Module | Purpose |
|---|---|---|
| `detectObsibooks(settings)` | `runner.ts` | Resolve and probe the CLI; returns `{ path, version } \| null` |
| `detectPandoc()` | `runner.ts` | Probe pandoc on PATH; returns `{ path, version } \| null` |
| `runConversion(cliPath, opts)` | `runner.ts` | Spawn the CLI, return a `RunController` |
| `DEFAULT_SETTINGS` | `settings.ts` | Merge with loaded data for backwards-compatible field additions |
| `ObsibooksSettingsTab` | `settings.ts` | Registered by `main.ts` |
| `PickerModal` / `LogModal` | `modals/*` | Open via `new ...(app, ...).open()` |
