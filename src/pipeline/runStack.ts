import { resolve } from "node:path";
import type { RunStatus, Stage } from "../core/events.js";
import type { StoragePort } from "../core/ports.js";
import type { Stack } from "../specs/types.js";
import { copyWorkspace } from "../workspace/copy.js";
import { cleanupWorkspace } from "../workspace/teardown.js";
import { buildAllowlistedEnv } from "../runtime/env.js";
import { runStage, type StageOutcome } from "../runtime/stage.js";

/** D2-20 pure pipeline outcome — the same status/failedStage the caller would
 * otherwise have to re-derive from the terminal BenchmarkFinishedEvent. */
export interface RunOutcome {
  runId: string;
  status: RunStatus;
  failedStage: Stage | null;
  screenshotArtifactId: string | null;
}

// Internal-only roots (D2-20: runStack is a fixed 3-arg function, no 4th
// config param) — never derived from spec-supplied values (isolation by
// construction, D2-06).
const TMP_ROOT = "tmp";
const NPM_CACHE_DIR = resolve("tmp/.npm-cache");

/**
 * D2-20 entrypoint: copy → install → build → (lint/test, non-fatal) → start
 * → wait-ready → screenshot → teardown. Every fatal-stage failure or timeout
 * maps to a scored RunOutcome (D2-13) — this promise never rejects.
 */
export async function runStack(stack: Stack, runId: string, storage: StoragePort): Promise<RunOutcome> {
  let seq = 0;

  // D2-17: per-stage timeouts resolved from the spec with generous built-in
  // fallbacks — this is the seam Plan 02-06 uses to force a fast timeout.
  const installTimeoutMs = stack.installTimeoutMs ?? 300000;
  const buildTimeoutMs = stack.buildTimeoutMs ?? 300000;
  const lintTimeoutMs = stack.lintTimeoutMs ?? 300000;
  const testTimeoutMs = stack.testTimeoutMs ?? 300000;
  const startTimeoutMs = stack.startTimeoutMs ?? 90000;
  const screenshotTimeoutMs = stack.screenshotTimeoutMs ?? 30000;

  const appDir = copyWorkspace(stack.template, runId, TMP_ROOT);
  const env = buildAllowlistedEnv(NPM_CACHE_DIR);

  /** Emits StageStarted before, StageCompleted/Failed after (D-06), and the
   * stage's combined log (D2-19). Shared by every stage that runs, fatal or not. */
  async function runAndRecordStage(stage: Stage, command: string, timeoutMs: number): Promise<StageOutcome> {
    storage.appendEvent({ type: "stage_started", runId, seq: seq++, ts: Date.now(), stage });
    const outcome = await runStage(stage, command, { cwd: appDir, env, timeoutMs });
    storage.appendEvent(
      outcome.exitCode === 0 && !outcome.timedOut
        ? {
            type: "stage_completed",
            runId,
            seq: seq++,
            ts: Date.now(),
            stage,
            durationMs: outcome.durationMs,
            exitCode: outcome.exitCode,
          }
        : {
            type: "stage_failed",
            runId,
            seq: seq++,
            ts: Date.now(),
            stage,
            durationMs: outcome.durationMs,
            exitCode: outcome.exitCode,
          },
    );
    storage.writeArtifact(runId, "log", `${stage}.log`, Buffer.from(outcome.logTail));
    return outcome;
  }

  /** D2-13: fatal outcome → terminal BenchmarkFinishedEvent + kept workspace + scored RunOutcome. */
  function failFatal(stage: Stage, timedOut: boolean): RunOutcome {
    const status: RunStatus = timedOut ? "timeout" : "build_failed";
    storage.appendEvent({ type: "benchmark_finished", runId, seq: seq++, ts: Date.now(), status, failedStage: stage });
    cleanupWorkspace(runId, true, TMP_ROOT);
    return { runId, status, failedStage: stage, screenshotArtifactId: null };
  }

  const installOutcome = await runAndRecordStage("install", stack.install, installTimeoutMs);
  if (installOutcome.exitCode !== 0 || installOutcome.timedOut) {
    return failFatal("install", installOutcome.timedOut);
  }

  const buildOutcome = await runAndRecordStage("build", stack.build, buildTimeoutMs);
  if (buildOutcome.exitCode !== 0 || buildOutcome.timedOut) {
    return failFatal("build", buildOutcome.timedOut);
  }

  // Task 2 continues here: dist size, lint/test (non-fatal), start, readiness,
  // screenshot, teardown — appended to this same sequence.
}
