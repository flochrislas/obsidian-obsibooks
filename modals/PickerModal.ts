/**
 * PickerModal — collects input path + conversion options from the user, then
 * hands control to a caller via the onRun callback. The actual spawn lives in
 * runner.ts; this modal is pure UI.
 */

import { App, Modal, Notice, Setting } from "obsidian";
import * as path from "path";
import type { ObsibooksSettings } from "../settings";

export interface PickerResult {
  inputPath: string;
  outputSubfolder: string;
  overwrite: boolean;
  compress: boolean;
}

type InputMode = "file" | "folder";

export class PickerModal extends Modal {
  private mode: InputMode = "file";
  private inputPath = "";
  private outputSubfolder: string;
  private overwrite: boolean;
  private compress: boolean;

  private pickedLabel!: HTMLElement;
  private runButton!: HTMLButtonElement;

  constructor(
    app: App,
    private defaults: ObsibooksSettings,
    private onRun: (r: PickerResult) => void,
  ) {
    super(app);
    this.outputSubfolder = defaults.defaultOutputSubfolder;
    this.overwrite = defaults.overwriteByDefault;
    this.compress = defaults.compressByDefault;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText("Convert ebook(s) to markdown");

    // ─── Mode toggle ───
    new Setting(contentEl)
      .setName("Input type")
      .addDropdown((dd) =>
        dd
          .addOption("file", "Single EPUB or PDF")
          .addOption("folder", "Folder of ebooks")
          .setValue(this.mode)
          .onChange((v) => {
            this.mode = v as InputMode;
            this.inputPath = "";
            this.refreshPickedLabel();
            this.refreshRunButton();
          })
      );

    // ─── Picker button + label ───
    new Setting(contentEl)
      .setName("Input path")
      .setDesc("Picks an absolute path on disk (the source can live anywhere, not just in the vault).")
      .addButton((b) =>
        b
          .setButtonText("Browse...")
          .onClick(() => this.openNativePicker())
      );

    this.pickedLabel = contentEl.createEl("p", {
      text: "(nothing picked yet)",
      cls: "obsibooks-picked",
    });

    // ─── Output subfolder ───
    new Setting(contentEl)
      .setName("Output subfolder (inside the vault)")
      .addText((t) =>
        t
          .setValue(this.outputSubfolder)
          .onChange((v) => {
            this.outputSubfolder = v.trim() || this.defaults.defaultOutputSubfolder;
          })
      );

    // ─── Options ───
    new Setting(contentEl)
      .setName("Overwrite already-converted books")
      .addToggle((t) =>
        t.setValue(this.overwrite).onChange((v) => { this.overwrite = v; })
      );

    new Setting(contentEl)
      .setName("Compress images after conversion")
      .setDesc(
        `Uses the defaults from settings: ${this.defaults.maxKb} kB, ` +
        `${this.defaults.maxWidth}×${this.defaults.maxHeight} px, quality ${this.defaults.quality}.`
      )
      .addToggle((t) =>
        t.setValue(this.compress).onChange((v) => { this.compress = v; })
      );

    // ─── Run / Cancel ───
    const buttonRow = contentEl.createDiv({ cls: "obsibooks-buttons" });
    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
    this.runButton = buttonRow.createEl("button", { text: "Convert", cls: "mod-cta" });
    this.runButton.addEventListener("click", () => this.handleRun());
    this.refreshRunButton();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /**
   * Use a hidden <input type="file"> to leverage Electron's native dialog.
   * For folder mode, webkitdirectory selects a directory and the parent dir
   * is derived from the first child's path.
   */
  private openNativePicker(): void {
    const input = document.createElement("input");
    input.type = "file";
    if (this.mode === "file") {
      input.accept = ".epub,.pdf";
    } else {
      input.setAttribute("webkitdirectory", "");
    }
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener("change", () => {
      try {
        const files = input.files;
        if (!files || files.length === 0) return;
        // File.path is exposed by Electron's renderer.
        const firstPath = (files[0] as unknown as { path: string }).path;
        if (!firstPath) {
          new Notice("Could not read the absolute path of the picked entry.");
          return;
        }
        this.inputPath = this.mode === "file" ? firstPath : path.dirname(firstPath);
        this.refreshPickedLabel();
        this.refreshRunButton();
      } finally {
        document.body.removeChild(input);
      }
    });

    input.click();
  }

  private refreshPickedLabel(): void {
    if (!this.inputPath) {
      this.pickedLabel.setText("(nothing picked yet)");
    } else {
      this.pickedLabel.setText(this.inputPath);
    }
  }

  private refreshRunButton(): void {
    this.runButton.disabled = !this.inputPath;
  }

  private handleRun(): void {
    if (!this.inputPath) return;
    this.close();
    this.onRun({
      inputPath: this.inputPath,
      outputSubfolder: this.outputSubfolder,
      overwrite: this.overwrite,
      compress: this.compress,
    });
  }
}
