import { execa, type Result, type ResultPromise } from "execa";
import type { Stage } from "../core/events.js";

/** D2-19: combined stdout+stderr log, tail-capped so a runaway stage can't fill disk. */
const TAIL_CAP_BYTES = 5 * 1024 * 1024;

export interface StageOutcome {
  stage: Stage;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  logTail: string;
}

/**
 * Keeps only the last `maxBytes` of `text` (D2-19 — the tail holds the
 * error). No-op when `text` is already under the cap.
 */
export function tailCap(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  return buf.subarray(buf.length - maxBytes).toString("utf8");
}

/**
 * Splits a simple `npm ...`-style command into `[file, ...args]`. v1's
 * commands are plain invocations with no quoted args, so a whitespace split
 * is sufficient — do not add a shell-arg parser (T-2-01: array-form only).
 */
function splitCommand(command: string): [string, string[]] {
  const [file, ...args] = command.split(/\s+/);
  return [file, args];
}

/**
 * Runs one blocking stage (install/build/lint/test) via array-form execa
 * (T-2-01 — the `shell` option is never set), enforcing `timeoutMs` and
 * tail-capping the combined log (D2-19). Never throws past the caller
 * (D2-13): spawn-level failures (e.g. ENOENT) are folded into a
 * non-zero-exit outcome instead.
 */
export async function runStage(
  stage: Stage,
  command: string,
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number },
): Promise<StageOutcome> {
  const start = Date.now();
  const [file, args] = splitCommand(command);
  try {
    const result: Result = await execa(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      extendEnv: false,
      timeout: opts.timeoutMs,
      reject: false,
      all: true,
    });
    return {
      stage,
      exitCode: result.exitCode ?? 1,
      durationMs: Date.now() - start,
      timedOut: result.timedOut ?? false,
      logTail: tailCap(String(result.all ?? ""), TAIL_CAP_BYTES),
    };
  } catch (err) {
    return {
      stage,
      exitCode: 1,
      durationMs: Date.now() - start,
      timedOut: false,
      logTail: tailCap(String(err), TAIL_CAP_BYTES),
    };
  }
}

/**
 * Starts the long-running "start" stage (WORK-04): array-form execa, never
 * awaited here since the process does not run to completion. `detached: true`
 * makes it the leader of its own POSIX process group so `killProcessTree`
 * can reach descendants `cleanup` alone would miss.
 */
export function startServer(
  command: string,
  opts: { cwd: string; env: Record<string, string> },
): { subprocess: ResultPromise } {
  const [file, args] = splitCommand(command);
  const subprocess = execa(file, args, {
    cwd: opts.cwd,
    env: opts.env,
    extendEnv: false,
    detached: true,
    cleanup: true,
    forceKillAfterDelay: 5000,
  });
  // `subprocess` is itself a promise that rejects on a non-zero exit or a
  // termination signal (e.g. from killProcessTree). Callers of startServer
  // inspect/kill it via the returned handle rather than awaiting it
  // directly, so mark it handled here to avoid an unhandled rejection
  // crashing the process (Node treats those as fatal by default).
  subprocess.catch(() => {});
  return { subprocess };
}

/**
 * Kills the whole POSIX process group (WORK-04) — not just the direct child
 * pid — so npm/ng/sirv-forked grandchildren are also reached. Falls back to
 * killing only the direct child on platforms without process-group support.
 */
export function killProcessTree(subprocess: ResultPromise): void {
  if (subprocess.pid === undefined) return;
  try {
    process.kill(-subprocess.pid, "SIGTERM");
  } catch {
    subprocess.kill("SIGTERM");
  }
}
