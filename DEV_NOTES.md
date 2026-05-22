# Dev notes — obsibooks Obsidian plugin

Snapshot of the consolidation + Obsidian-plugin work, kept for context in future sessions and as a release playbook.

## Two-repo layout

| Repo | Path on disk | Role |
|---|---|---|
| `obsibooks` | `g:/Nodes Network/Projets/obsibooks/` | The Python CLI + customtkinter GUI. The engine that actually converts ebooks and compresses images. |
| `obsidian-obsibooks` | `g:/Nodes Network/Projets/obsidian-obsibooks/` | The Obsidian community plugin. Thin TypeScript driver that spawns the Python CLI via `child_process` and shows a log inside Obsidian. |

The plugin **never imports Python code** — it spawns the CLI. Their only contract is:
- `obsibooks --version` → prints `obsibooks <version>`, exit 0.
- `obsibooks <path> -d <dir> [--overwrite] [--compress --max-kb N --max-width N --max-height N --quality N]` → progress on stdout/stderr, exit 0 on success.

Anything else inside obsibooks is free to evolve.

## What was built

### Python repo (`obsibooks`)

| File | Purpose |
|---|---|
| `obsibooks.py` | Existing orchestrator. **Added** `__version__ = "0.1.0"` and an argparse `--version` flag. |
| `pyproject.toml` | **New.** PEP 621 metadata, setuptools backend. `console_scripts: obsibooks = obsibooks:main`. Dynamic version sourced from `obsibooks.__version__`. Runtime deps pinned; `customtkinter` lives under the optional `[gui]` extra so headless installs stay lean. `py-modules` lists the four flat module files. |
| `README.md` | **Edited.** New *Install* section above *Usage* — three paths: `pip install obsibooks`, prebuilt binary from GitHub releases, source clone. Pandoc requirement called out as separate from the install method. |
| `.github/workflows/release.yml` | **New.** Triggered on tags matching `v*.*.*`. Three jobs: (1) build sdist + wheel, publish to PyPI via trusted publishing (OIDC, no token); (2) matrix-build PyInstaller `--onefile` binaries on Ubuntu/macOS/Windows, rename to `obsibooks-linux` / `obsibooks-macos` / `obsibooks-windows.exe`; (3) attach all three binaries to the GitHub release. |

### Plugin repo (`obsidian-obsibooks`)

| File | Purpose |
|---|---|
| `manifest.json` | `id=obsibooks`, `name=Obsibooks`, `version=0.1.0`, `minAppVersion=1.5.0`, `isDesktopOnly=true`. |
| `versions.json` | `{ "0.1.0": "1.5.0" }`. |
| `main.ts` | Plugin entry. Loads settings, registers the settings tab, registers the single command **Obsibooks: Convert ebook(s) to markdown**, wires PickerModal → runner → LogModal. Resolves the vault base via `FileSystemAdapter.getBasePath()`. |
| `runner.ts` | The only non-trivial module. `which`/`where` resolution, `<cli> --version` probe with 3-second timeout, pandoc detection, `child_process.spawn` driver with line-split stdout/stderr. Returns a `RunController { onEvent, kill, finished }`. |
| `settings.ts` | Three-section settings tab (CLI installation, default output, default compression). Live detection status row. Custom-path and binary-path text fields appear conditionally on `cliMode`. Auto-download button fetches the matching `obsibooks-<os>` asset from the obsibooks repo's latest GitHub release, writes it under `<vault>/.obsidian/plugins/obsibooks/`, and chmod +x on Unix. |
| `modals/PickerModal.ts` | Single-file / folder radio, native picker via hidden `<input type="file">` (folder mode uses `webkitdirectory` and derives the parent via `path.dirname(files[0].path)`), output subfolder text, Overwrite + Compress toggles. Sends a `PickerResult` to the caller. |
| `modals/LogModal.ts` | Streaming `<pre>` consumes the runner's `RunEvent` stream. Cancel button while running, swap to Close + *Open output* on success. *Open output* hunts for the newest `00 - *.md` index under the output subfolder and opens it. |
| `styles.css` | Status colors, picked-path label, log box layout. |
| `package.json`, `tsconfig.json`, `esbuild.config.mjs` | Standard sample-plugin scaffold from `obsidianmd/obsidian-sample-plugin`. |
| `README.md` | End-user docs (setup + usage + settings table + dev section). |
| `LICENSE` | GPL-3.0-or-later, matching the Python tool. |
| `.gitignore` | Standard plugin ignores: `node_modules/`, `main.js`, `*.js.map`, `data.json`, etc. |
| `.github/workflows/release.yml` | On tag (no `v` prefix, per Obsidian convention), `npm ci && npm run build`, attach `manifest.json` + `main.js` + `styles.css` to the GitHub release. |

**Build verified locally:** `npm install && npm run build` succeeds; `main.js` ~14.7 KB.

## Decisions captured

- **Architecture: shell-out, not TS port.** PyMuPDF4llm has no JS equivalent for PDF chapter structure; porting would degrade the product. Precedent in the community store (Shell Commands, Python Scripter, Pandoc Reference List, Markitdown File Converter).
- **`isDesktopOnly: true`.** The shell-out model has no mobile counterpart. Accepted trade-off for a bulk-conversion tool.
- **Two repos, two release pipelines.** Versioned independently. The plugin links to the Python tool's install docs rather than bundling it.
- **Python distribution: PyPI + PyInstaller binaries.** Power users use pip; everyone else clicks *Download* in plugin settings. The plugin's auto-download reads the obsibooks repo's *latest* release assets.
- **Pandoc is not bundled.** ~150 MB per platform, separate licensing story. User installs it; plugin detects and warns.
- **v1 scope: one command, one picker, one log modal, one settings page.** No ribbon icon, no in-vault file-menu integration, no batch checkbox UI, no compress-only flow. All deferrable.

## What's left to ship

These steps need your accounts / one-time decisions; the codebase is ready.

1. **Push both repos to GitHub.**
   - `obsibooks` is already a git repo locally — first push to `github.com/flochrislas/obsibooks`.
   - `obsidian-obsibooks` needs `git init` first.
2. **Configure PyPI trusted publishing** (one-time, via the PyPI web UI). Add a Trusted Publisher pointing to:
   - Owner: `flochrislas`
   - Repo: `obsibooks`
   - Workflow: `release.yml`
   - Environment: (leave blank or set if desired)
   - Reference: https://docs.pypi.org/trusted-publishers/
3. **First tags:**
   - `obsibooks` repo: `git tag v0.1.0 && git push --tags` → `release.yml` publishes to PyPI and builds three binaries.
   - `obsidian-obsibooks` repo: `git tag 0.1.0 && git push --tags` (no `v` prefix — Obsidian convention) → `release.yml` builds and attaches `manifest.json` + `main.js` + `styles.css`.
4. **Smoke-test the plugin locally** before submitting:
   - Symlink `manifest.json`, `main.js`, `styles.css` into a test vault: `<vault>/.obsidian/plugins/obsibooks/`.
   - Enable in Settings → Community plugins.
   - Settings tab should show *obsibooks 0.1.0 detected at …* and *pandoc … detected*.
   - Run command on `g:/Nodes Network/Projets/pepub/test_epubs/Antifragile.epub` → confirm `<vault>/Books/Antifragile/00 - Antifragile.md` opens.
   - Repeat with a PDF and a mixed folder; tick *Compress images* on one run and confirm `assets/*.webp`.
5. **Submit to community plugins:** PR against `obsidianmd/obsidian-releases` adding one line to `community-plugins.json`. Reviewer typically asks about: license, desktop-only justification, absence of remote code execution.

## Out of scope (deferred to v1.x / v2)

- Ribbon icon, file-menu integration on `.epub`/`.pdf` files already inside the vault, batch-import checkbox UI.
- Compress-only flow inside the plugin (today: `python compress_images.py <vault>`).
- Mobile support (architecturally impossible while shelling out to Python).
- Bundling pandoc.
- Iterative quality reduction for compressed PNGs that still exceed `--max-kb` after one lossy pass.

## Cross-references

- Plan document: `C:\Users\flore\.claude\plans\vast-chasing-ritchie.md`
- Python project guidance: `g:/Nodes Network/Projets/obsibooks/CLAUDE.md`
