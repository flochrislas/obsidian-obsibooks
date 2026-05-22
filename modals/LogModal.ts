/**
 * LogModal — streams stdout/stderr from a RunController into a <pre> element.
 * Shows a Cancel button while the run is live, swaps to an "Open output" hint
 * on success, leaves errors visible on failure.
 */

import { App, Modal, Notice, normalizePath, TFile, TFolder } from "obsidian";
import type { RunController, RunEvent } from "../runner";

export class LogModal extends Modal {
  private logEl!: HTMLPreElement;
  private cancelBtn!: HTMLButtonElement;
  private closeBtn!: HTMLButtonElement;
  private openOutputBtn!: HTMLButtonElement;
  private cancelled = false;

  constructor(
    app: App,
    private controller: RunController,
    /** Vault-relative path to the output subfolder, e.g. "Books". Used to locate
     *  the first index file (00 - *.md) after a successful run so we can offer
     *  to open it. */
    private vaultOutputSubfolder: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText("Converting...");

    this.logEl = contentEl.createEl("pre", { cls: "obsibooks-log" });

    const buttonRow = contentEl.createDiv({ cls: "obsibooks-buttons" });
    this.cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    this.cancelBtn.addEventListener("click", () => {
      this.cancelled = true;
      this.controller.kill();
      this.append("[cancelled by user]");
    });

    this.openOutputBtn = buttonRow.createEl("button", {
      text: "Open output",
      cls: "mod-cta",
    });
    this.openOutputBtn.style.display = "none";
    this.openOutputBtn.addEventListener("click", () => void this.openFirstIndex());

    this.closeBtn = buttonRow.createEl("button", { text: "Close" });
    this.closeBtn.style.display = "none";
    this.closeBtn.addEventListener("click", () => this.close());

    this.controller.onEvent((e) => this.handleEvent(e));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private handleEvent(e: RunEvent): void {
    if (e.kind === "stdout" || e.kind === "stderr") {
      this.append(e.line);
    } else {
      this.append(`\n[exit ${e.code}]`);
      this.cancelBtn.style.display = "none";
      this.closeBtn.style.display = "";
      if (e.code === 0 && !this.cancelled) {
        this.titleEl.setText("Conversion finished");
        this.openOutputBtn.style.display = "";
        void this.maybeAutoOpenIndex();
      } else if (this.cancelled) {
        this.titleEl.setText("Conversion cancelled");
      } else {
        this.titleEl.setText("Conversion failed");
      }
    }
  }

  private append(line: string): void {
    this.logEl.appendText(line + "\n");
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /**
   * Try to find a recently-created `<book>/00 - <title>.md` under the output
   * subfolder and open it. Best-effort; silent failure.
   */
  private async maybeAutoOpenIndex(): Promise<void> {
    const target = await this.findFirstIndex();
    if (target) {
      await this.app.workspace.getLeaf(false).openFile(target);
      this.close();
    }
  }

  private async openFirstIndex(): Promise<void> {
    const target = await this.findFirstIndex();
    if (!target) {
      new Notice("No index file found yet — the vault index may still be refreshing.");
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(target);
    this.close();
  }

  private async findFirstIndex(): Promise<TFile | null> {
    const folderPath = normalizePath(this.vaultOutputSubfolder);
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) return null;

    let bestFile: TFile | null = null;
    let bestMtime = -1;
    for (const child of folder.children) {
      if (!(child instanceof TFolder)) continue;
      for (const grandchild of child.children) {
        if (
          grandchild instanceof TFile &&
          grandchild.name.startsWith("00 - ") &&
          grandchild.extension === "md" &&
          grandchild.stat.mtime > bestMtime
        ) {
          bestMtime = grandchild.stat.mtime;
          bestFile = grandchild;
        }
      }
    }
    return bestFile;
  }
}
