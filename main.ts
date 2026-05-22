/**
 * Obsibooks — Obsidian plugin entry point.
 *
 * Registers a single command ("Obsibooks: Convert ebook(s) to markdown") that
 * opens PickerModal → detects the CLI → runs conversion → streams the log in
 * LogModal. All heavy lifting happens in the user-installed obsibooks Python
 * CLI; this plugin is a thin driver.
 *
 * Desktop-only (manifest.json: isDesktopOnly=true) — the shell-out model has
 * no mobile counterpart.
 */

import { FileSystemAdapter, Notice, Plugin, normalizePath } from "obsidian";
import * as path from "path";
import * as fs from "fs";
import {
  detectObsibooks,
  runConversion,
  type ConversionOptions,
} from "./runner";
import {
  DEFAULT_SETTINGS,
  ObsibooksSettings,
  ObsibooksSettingsTab,
} from "./settings";
import { PickerModal, PickerResult } from "./modals/PickerModal";
import { LogModal } from "./modals/LogModal";

export default class ObsibooksPlugin extends Plugin {
  settings!: ObsibooksSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new ObsibooksSettingsTab(this.app, this));

    this.addCommand({
      id: "convert",
      name: "Convert ebook(s) to markdown",
      callback: () => this.openPicker(),
    });
  }

  onunload(): void {
    // No persistent resources to release.
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private openPicker(): void {
    new PickerModal(this.app, this.settings, (r) => this.runFromPicker(r)).open();
  }

  private async runFromPicker(r: PickerResult): Promise<void> {
    const cli = await detectObsibooks(this.settings);
    if (!cli) {
      new Notice(
        "obsibooks not found. Open the plugin settings and configure the CLI installation.",
      );
      return;
    }

    const basePath = this.vaultBasePath();
    if (!basePath) {
      new Notice("This vault has no on-disk path; obsibooks needs a file-system vault.");
      return;
    }

    const outputDir = path.join(basePath, r.outputSubfolder);
    try {
      fs.mkdirSync(outputDir, { recursive: true });
    } catch (e: any) {
      new Notice(`Cannot create output folder: ${e.message}`);
      return;
    }

    const opts: ConversionOptions = {
      inputPath: r.inputPath,
      outputDir,
      overwrite: r.overwrite,
      compress: r.compress,
      maxKb: this.settings.maxKb,
      maxWidth: this.settings.maxWidth,
      maxHeight: this.settings.maxHeight,
      quality: this.settings.quality,
    };

    const controller = runConversion(cli.path, opts);
    // Trigger a vault refresh once the run finishes so the new markdown files
    // show up in the file explorer and the LogModal can locate the index.
    void controller.finished().then(() => this.refreshVaultUnder(r.outputSubfolder));

    new LogModal(this.app, controller, r.outputSubfolder).open();
  }

  private vaultBasePath(): string | null {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) return adapter.getBasePath();
    return null;
  }

  private async refreshVaultUnder(subfolder: string): Promise<void> {
    // Obsidian rescans the vault on focus changes, but for a CLI write the
    // explorer doesn't notice automatically. Touching a known path nudges it.
    const norm = normalizePath(subfolder);
    const folder = this.app.vault.getAbstractFileByPath(norm);
    if (folder) {
      // No public force-rescan API; rely on Obsidian's own watcher to catch up.
      // This function is a placeholder to make the intent explicit at the call site.
    }
  }
}
