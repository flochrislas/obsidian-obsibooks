# Obsibooks (Obsidian plugin)

Convert EPUB and PDF ebooks to Obsidian-flavored markdown — one folder per book, one note per chapter, YAML-fronted index, images extracted to `assets/`, optional in-place WebP compression — all from inside Obsidian.

This plugin is a thin driver around the [obsibooks](https://github.com/flochrislas/obsibooks) Python CLI. The plugin handles the UI; the CLI does the conversion. **Desktop only** — the shell-out architecture has no mobile counterpart.

## Setup

You need two things on your machine:

1. The **obsibooks CLI**. Three ways to install it:
   - `pip install obsibooks` *(simplest if you have Python)*
   - Download a standalone binary from the [obsibooks releases page](https://github.com/flochrislas/obsibooks/releases) and use the plugin's *Download binary for this OS* button in settings.
   - Clone the source repo and `pip install -e .`.
2. **Pandoc** on your PATH, for EPUB conversion. (`winget install --id JohnMacFarlane.Pandoc` on Windows, `brew install pandoc` on macOS.) PDF-only conversions don't need it.

Open *Settings → Obsibooks* — the top of the page shows whether each is detected.

## Usage

1. Run the command **Obsibooks: Convert ebook(s) to markdown** from the command palette (Ctrl/Cmd-P).
2. Pick a single `.epub`/`.pdf` or a folder of them. Sources can live anywhere on disk — they don't need to be inside the vault.
3. Choose an output subfolder inside the vault (default: `Books`).
4. Tick *Overwrite* if you want to re-convert books whose folder already exists.
5. Tick *Compress images* to re-encode oversized images to WebP after conversion. Defaults come from settings.
6. Click *Convert*. Progress streams in a log dialog; on success the first book's index file opens automatically.

## Settings

| Setting | What it does |
|---|---|
| Install mode | `auto` (search PATH), `binary` (use a downloaded standalone executable), `custom` (point at an arbitrary path) |
| Custom CLI path | Absolute path to your `obsibooks` script — when *Install mode* is `custom` |
| Binary path | Where the downloaded standalone executable lives — when *Install mode* is `binary` |
| Output subfolder | Vault-relative directory where converted books are written (default `Books`) |
| Overwrite by default | Pre-tick the Overwrite checkbox in the conversion dialog |
| Compress by default | Pre-tick the Compress images checkbox in the conversion dialog |
| Max file size (kB) | Compression: shrink images larger than this |
| Max width / Max height | Compression: resize images larger than these dimensions |
| WebP quality | Compression: lossy quality (PNG falls back to lossy when lossless exceeds Max file size) |

## Development

```bash
git clone https://github.com/flochrislas/obsidian-obsibooks.git
cd obsidian-obsibooks
npm install
npm run dev      # esbuild watch
```

Copy `manifest.json`, `main.js`, and `styles.css` into a test vault's `.obsidian/plugins/obsibooks/` to try it. Production build: `npm run build`.

## License

GPL-3.0-or-later — see [LICENSE](./LICENSE).
