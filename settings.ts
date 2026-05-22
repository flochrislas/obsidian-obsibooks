/**
 * settings.ts
 *
 * Settings model + persistence + SettingsTab UI.
 *
 * Three sections in the UI:
 *   1. CLI installation — mode selector, status, custom path, binary path,
 *      and a "Download binary for this OS" button that fetches the matching
 *      asset from the obsibooks GitHub release.
 *   2. Default output — vault subfolder + overwrite toggle.
 *   3. Default compression — toggle + max-kb / max-width / max-height / quality.
 */

import { App, Notice, PluginSettingTab, Setting, requestUrl } from "obsidian";
import * as path from "path";
import * as fs from "fs";
import type ObsibooksPlugin from "./main";
import { detectObsibooks, detectPandoc } from "./runner";

export type CliMode = "auto" | "binary" | "custom";

export interface ObsibooksSettings {
  cliMode: CliMode;
  customCliPath: string;
  binaryPath: string;
  defaultOutputSubfolder: string;
  overwriteByDefault: boolean;
  compressByDefault: boolean;
  maxKb: number;
  maxWidth: number;
  maxHeight: number;
  quality: number;
}

export const DEFAULT_SETTINGS: ObsibooksSettings = {
  cliMode: "auto",
  customCliPath: "",
  binaryPath: "",
  defaultOutputSubfolder: "Books",
  overwriteByDefault: false,
  compressByDefault: false,
  maxKb: 500,
  maxWidth: 1024,
  maxHeight: 1024,
  quality: 85,
};

const RELEASE_API = "https://api.github.com/repos/flochrislas/obsibooks/releases/latest";

function platformAssetName(): string | null {
  switch (process.platform) {
    case "win32":  return "obsibooks-windows.exe";
    case "darwin": return "obsibooks-macos";
    case "linux":  return "obsibooks-linux";
    default:       return null;
  }
}

export class ObsibooksSettingsTab extends PluginSettingTab {
  plugin: ObsibooksPlugin;

  constructor(app: App, plugin: ObsibooksPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ─── Section 1: CLI installation ───
    containerEl.createEl("h2", { text: "CLI installation" });

    const statusEl = containerEl.createEl("p", {
      text: "Checking obsibooks installation...",
      cls: "obsibooks-status",
    });
    void this.refreshStatus(statusEl);

    new Setting(containerEl)
      .setName("Install mode")
      .setDesc(
        "auto: search PATH for the `obsibooks` command. " +
        "binary: use a downloaded standalone executable. " +
        "custom: use a path you configure below."
      )
      .addDropdown((dd) =>
        dd
          .addOption("auto", "Auto (search PATH)")
          .addOption("binary", "Bundled binary")
          .addOption("custom", "Custom path")
          .setValue(this.plugin.settings.cliMode)
          .onChange(async (v) => {
            this.plugin.settings.cliMode = v as CliMode;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.cliMode === "custom") {
      new Setting(containerEl)
        .setName("Custom CLI path")
        .setDesc("Absolute path to the obsibooks executable or Python script.")
        .addText((t) =>
          t
            .setPlaceholder("/usr/local/bin/obsibooks")
            .setValue(this.plugin.settings.customCliPath)
            .onChange(async (v) => {
              this.plugin.settings.customCliPath = v.trim();
              await this.plugin.saveSettings();
            })
        );
    }

    if (this.plugin.settings.cliMode === "binary") {
      new Setting(containerEl)
        .setName("Binary path")
        .setDesc("Set automatically by the download button below, or paste a path manually.")
        .addText((t) =>
          t
            .setPlaceholder("(downloads to plugin data folder)")
            .setValue(this.plugin.settings.binaryPath)
            .onChange(async (v) => {
              this.plugin.settings.binaryPath = v.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Download binary for this OS")
        .setDesc(
          "Fetches the matching obsibooks release asset from GitHub. " +
          "You still need pandoc installed separately for EPUB conversion."
        )
        .addButton((b) =>
          b
            .setButtonText("Download")
            .setCta()
            .onClick(async () => {
              b.setDisabled(true).setButtonText("Downloading...");
              try {
                const target = await this.downloadLatestBinary();
                this.plugin.settings.binaryPath = target;
                await this.plugin.saveSettings();
                new Notice(`Downloaded to ${target}`);
                this.display();
              } catch (err: any) {
                new Notice(`Download failed: ${err.message}`);
              } finally {
                b.setDisabled(false).setButtonText("Download");
              }
            })
        );
    }

    // ─── Section 2: Default output ───
    containerEl.createEl("h2", { text: "Default output" });

    new Setting(containerEl)
      .setName("Output subfolder (in the vault)")
      .setDesc("Converted books are written under this subfolder of the active vault.")
      .addText((t) =>
        t
          .setPlaceholder("Books")
          .setValue(this.plugin.settings.defaultOutputSubfolder)
          .onChange(async (v) => {
            this.plugin.settings.defaultOutputSubfolder = v.trim() || "Books";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Overwrite by default")
      .setDesc("Pre-tick the Overwrite checkbox in the conversion dialog.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.overwriteByDefault)
          .onChange(async (v) => {
            this.plugin.settings.overwriteByDefault = v;
            await this.plugin.saveSettings();
          })
      );

    // ─── Section 3: Default compression ───
    containerEl.createEl("h2", { text: "Default compression" });

    new Setting(containerEl)
      .setName("Compress by default")
      .setDesc("Pre-tick the Compress images checkbox in the conversion dialog.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.compressByDefault)
          .onChange(async (v) => {
            this.plugin.settings.compressByDefault = v;
            await this.plugin.saveSettings();
          })
      );

    this.addNumberSetting(containerEl, "Max file size (kB)", "maxKb", 1, 100000);
    this.addNumberSetting(containerEl, "Max width (px)", "maxWidth", 1, 10000);
    this.addNumberSetting(containerEl, "Max height (px)", "maxHeight", 1, 10000);
    this.addNumberSetting(containerEl, "WebP quality (1–100)", "quality", 1, 100);
  }

  private addNumberSetting(
    containerEl: HTMLElement,
    name: string,
    key: "maxKb" | "maxWidth" | "maxHeight" | "quality",
    min: number,
    max: number,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings[key]))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (Number.isFinite(n) && n >= min && n <= max) {
              this.plugin.settings[key] = n;
              await this.plugin.saveSettings();
            }
          })
      );
  }

  private async refreshStatus(el: HTMLElement): Promise<void> {
    const cli = await detectObsibooks(this.plugin.settings);
    const pandoc = await detectPandoc();
    el.empty();
    if (cli) {
      el.createEl("span", {
        text: `✓ obsibooks ${cli.version} detected at ${cli.path}`,
        cls: "obsibooks-status-ok",
      });
    } else {
      el.createEl("span", {
        text: "✗ obsibooks not found. Install with `pip install obsibooks` or download a binary below.",
        cls: "obsibooks-status-err",
      });
    }
    el.createEl("br");
    if (pandoc) {
      el.createEl("span", {
        text: `✓ pandoc ${pandoc.version} detected (required for EPUB)`,
        cls: "obsibooks-status-ok",
      });
    } else {
      el.createEl("span", {
        text: "⚠ pandoc not found. EPUB conversion will fail until you install it.",
        cls: "obsibooks-status-warn",
      });
    }
  }

  private async downloadLatestBinary(): Promise<string> {
    const assetName = platformAssetName();
    if (!assetName) throw new Error(`Unsupported platform: ${process.platform}`);

    const meta = await requestUrl({ url: RELEASE_API, throw: true });
    const release = meta.json as { assets: Array<{ name: string; browser_download_url: string }> };
    const asset = release.assets.find((a) => a.name === assetName);
    if (!asset) throw new Error(`No ${assetName} asset on latest release`);

    const binResp = await requestUrl({ url: asset.browser_download_url, throw: true });
    const dir = this.pluginDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, assetName);
    fs.writeFileSync(target, Buffer.from(binResp.arrayBuffer));
    if (process.platform !== "win32") fs.chmodSync(target, 0o755);
    return target;
  }

  private pluginDataDir(): string {
    // Plugin data lives at <vault>/.obsidian/plugins/<id>/
    const adapter = this.app.vault.adapter as unknown as { getBasePath?: () => string };
    const base = adapter.getBasePath ? adapter.getBasePath() : "";
    return path.join(base, this.app.vault.configDir, "plugins", this.plugin.manifest.id);
  }
}
