/**
 * runner.ts
 *
 * Detects the obsibooks CLI on the user's system and drives a conversion run
 * via child_process. The plugin never imports Python — it spawns the CLI and
 * line-buffers stdout/stderr into events the UI can render.
 */

import { spawn, ChildProcess } from "child_process";
import * as path from "path";

export interface RunnerSettings {
  cliMode: "auto" | "binary" | "custom";
  customCliPath: string;
  binaryPath: string;
}

export interface ConversionOptions {
  inputPath: string;       // absolute path to file or folder
  outputDir: string;       // absolute path to vault subfolder
  overwrite: boolean;
  compress: boolean;
  maxKb: number;
  maxWidth: number;
  maxHeight: number;
  quality: number;
}

export interface DetectedTool {
  path: string;
  version: string;
}

export type RunEvent =
  | { kind: "stdout"; line: string }
  | { kind: "stderr"; line: string }
  | { kind: "exit"; code: number | null };

export interface RunController {
  onEvent(handler: (e: RunEvent) => void): void;
  kill(): void;
  finished(): Promise<number | null>;
}

const DETECT_TIMEOUT_MS = 3000;

/**
 * Resolve a bare command name to an absolute path using `where` (Windows) or
 * `which` (Unix). Returns the first hit, or null if not found.
 */
function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const checker = process.platform === "win32" ? "where" : "which";
    let buf = "";
    const child = spawn(checker, [cmd], { shell: false });
    child.stdout.on("data", (d) => { buf += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) {
        const first = buf.split(/\r?\n/)[0]?.trim();
        resolve(first || null);
      } else {
        resolve(null);
      }
    });
    child.on("error", () => resolve(null));
  });
}

/**
 * Run `<cmdPath> --version` and try to read an `obsibooks <semver>` line.
 * Times out after 3 seconds. Returns null if the candidate is not obsibooks.
 */
function probeObsibooks(cmdPath: string): Promise<DetectedTool | null> {
  return new Promise((resolve) => {
    let buf = "";
    let settled = false;

    const finish = (result: DetectedTool | null) => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* noop */ }
      resolve(result);
    };

    const child = spawn(cmdPath, ["--version"], { shell: false });
    const t = setTimeout(() => finish(null), DETECT_TIMEOUT_MS);

    child.stdout.on("data", (d) => { buf += d.toString(); });
    child.stderr.on("data", (d) => { buf += d.toString(); });
    child.on("error", () => { clearTimeout(t); finish(null); });
    child.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) return finish(null);
      const match = buf.match(/obsibooks\s+([\d.]+\S*)/i);
      if (!match) return finish(null);
      finish({ path: cmdPath, version: match[1] });
    });
  });
}

/**
 * Probe in priority order based on the user's settings:
 *   1. customCliPath (if mode=custom)
 *   2. binaryPath    (if mode=binary)
 *   3. `obsibooks` on PATH (auto)
 * Returns the first one that responds to `--version` successfully.
 */
export async function detectObsibooks(s: RunnerSettings): Promise<DetectedTool | null> {
  const candidates: string[] = [];

  if (s.cliMode === "custom" && s.customCliPath.trim()) {
    candidates.push(s.customCliPath.trim());
  }
  if (s.cliMode === "binary" && s.binaryPath.trim()) {
    candidates.push(s.binaryPath.trim());
  }
  if (s.cliMode === "auto") {
    const resolved = await which("obsibooks");
    if (resolved) candidates.push(resolved);
  }

  for (const c of candidates) {
    const found = await probeObsibooks(c);
    if (found) return found;
  }
  return null;
}

/**
 * Detect pandoc on PATH. Used to warn before EPUB conversions only; PDF runs
 * do not need pandoc.
 */
export async function detectPandoc(): Promise<DetectedTool | null> {
  const resolved = await which("pandoc");
  if (!resolved) return null;
  return new Promise((resolve) => {
    let buf = "";
    const child = spawn(resolved, ["--version"], { shell: false });
    const t = setTimeout(() => { try { child.kill(); } catch { /* noop */ } resolve(null); }, DETECT_TIMEOUT_MS);
    child.stdout.on("data", (d) => { buf += d.toString(); });
    child.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) return resolve(null);
      const match = buf.match(/pandoc\s+([\d.]+)/i);
      resolve(match ? { path: resolved, version: match[1] } : { path: resolved, version: "unknown" });
    });
    child.on("error", () => { clearTimeout(t); resolve(null); });
  });
}

/**
 * Spawn the CLI with the right argv for the given conversion options. Returns
 * a controller that emits stdout/stderr lines and an exit event.
 */
export function runConversion(cliPath: string, opts: ConversionOptions): RunController {
  const args: string[] = [opts.inputPath, "-d", opts.outputDir];
  if (opts.overwrite) args.push("--overwrite");
  if (opts.compress) {
    args.push(
      "--compress",
      "--max-kb", String(opts.maxKb),
      "--max-width", String(opts.maxWidth),
      "--max-height", String(opts.maxHeight),
      "--quality", String(opts.quality),
    );
  }

  const child: ChildProcess = spawn(cliPath, args, {
    shell: false,
    cwd: path.dirname(cliPath) || undefined,
    env: process.env,
  });

  const handlers: Array<(e: RunEvent) => void> = [];
  const emit = (e: RunEvent) => { for (const h of handlers) h(e); };

  const splitter = (which: "stdout" | "stderr") => {
    let pending = "";
    return (chunk: Buffer | string) => {
      pending += chunk.toString();
      let idx: number;
      while ((idx = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, idx).replace(/\r$/, "");
        pending = pending.slice(idx + 1);
        emit({ kind: which, line });
      }
    };
  };

  child.stdout?.on("data", splitter("stdout"));
  child.stderr?.on("data", splitter("stderr"));

  let exitResolve: (code: number | null) => void = () => {};
  const finishedPromise = new Promise<number | null>((res) => { exitResolve = res; });

  child.on("close", (code) => {
    emit({ kind: "exit", code });
    exitResolve(code);
  });
  child.on("error", (err) => {
    emit({ kind: "stderr", line: `Spawn error: ${err.message}` });
    emit({ kind: "exit", code: null });
    exitResolve(null);
  });

  return {
    onEvent(handler) { handlers.push(handler); },
    kill() { try { child.kill("SIGTERM"); } catch { /* noop */ } },
    finished() { return finishedPromise; },
  };
}
