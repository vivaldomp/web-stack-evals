import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RunStatus, Stage } from "../core/events.js";
import type { StoragePort } from "../core/ports.js";
import type { Stack } from "../specs/types.js";
import { copyWorkspace } from "../workspace/copy.js";
import { cleanupWorkspace } from "../workspace/teardown.js";
import { buildAllowlistedEnv } from "../runtime/env.js";
import { runStage, startServer, killProcessTree, type StageOutcome } from "../runtime/stage.js";
import { waitForHttp200 } from "../runtime/readiness.js";
import { renderWithPage, type LiveRenderResult } from "../render/renderWithPage.js";

/** D2-18: recursive byte sum under `dir`; 0 (not a throw) when it doesn't exist. */
function sumDirBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? sumDirBytes(full) : statSync(full).size;
  }
  return total;
}

/** D2-20 pure pipeline outcome — the same status/failedStage the caller would
 * otherwise have to re-derive from the terminal BenchmarkFinishedEvent. */
export interface RunOutcome {
  runId: string;
  status: RunStatus;
  failedStage: Stage | null;
  screenshotArtifactId: string | null;
}

/**
 * D5-13 additive parameterization — the ONLY caller-facing knob on runStack:
 * `prePopulated` builds the orchestrator's already-laid + agent-mutated
 * workspace instead of re-copying the pristine template (gap #1); `onLivePage`
 * receives the live Playwright page with the server still up so an evaluator
 * (axe) can run before teardown (gap #2). Neither derives an internal isolation
 * root from spec values — isolation still holds by construction (D2-06).
 */
export interface RunStackOptions {
  prePopulated?: boolean;
  onLivePage?: (page: LiveRenderResult["page"], generatedPng: Buffer) => Promise<void>;
}

// Internal-only roots (D2-20: runStack's optional 4th `opts` param carries only
// prePopulated/onLivePage — it never derives TMP_ROOT/NPM_CACHE_DIR from
// spec-supplied values, so isolation holds by construction, D2-06).
const TMP_ROOT = "tmp";
const NPM_CACHE_DIR = resolve("tmp/.npm-cache");

/**
 * D2-20 entrypoint: copy → install → build → (lint/test, non-fatal) → start
 * → wait-ready → screenshot → teardown. Every fatal-stage failure or timeout
 * maps to a scored RunOutcome (D2-13) — this promise never rejects.
 */
export async function runStack(
  stack: Stack,
  runId: string,
  storage: StoragePort,
  opts?: RunStackOptions,
): Promise<RunOutcome> {
  // D4-26: storage stamps each event's per-run `seq` at append time — this
  // producer yields seqless drafts, so it can share the run's log with the
  // agent adapter without a coordinated counter.

  // D2-17: per-stage timeouts resolved from the spec with generous built-in
  // fallbacks — this is the seam Plan 02-06 uses to force a fast timeout.
  const installTimeoutMs = stack.installTimeoutMs ?? 300000;
  const buildTimeoutMs = stack.buildTimeoutMs ?? 300000;
  const lintTimeoutMs = stack.lintTimeoutMs ?? 300000;
  const testTimeoutMs = stack.testTimeoutMs ?? 300000;
  const startTimeoutMs = stack.startTimeoutMs ?? 90000;

  // D5-13 gap #1: when the orchestrator has already laid + agent-mutated the
  // workspace, build THAT dir (the exact location copyWorkspace targets) rather
  // than re-copying the pristine template over the agent's work. Default (no
  // opts) keeps the 3-arg copy-then-build behavior byte-for-byte.
  const appDir = opts?.prePopulated
    ? resolve(TMP_ROOT, runId, "angular")
    : copyWorkspace(stack.template, runId, TMP_ROOT);
  const env = buildAllowlistedEnv(NPM_CACHE_DIR);

  /** Emits StageStarted before, StageCompleted/Failed after (D-06), and the
   * stage's combined log (D2-19). Shared by every stage that runs, fatal or not. */
  async function runAndRecordStage(stage: Stage, command: string, timeoutMs: number): Promise<StageOutcome> {
    storage.appendEvent({ type: "stage_started", runId, ts: Date.now(), stage });
    const outcome = await runStage(stage, command, { cwd: appDir, env, timeoutMs });
    storage.appendEvent(
      outcome.exitCode === 0 && !outcome.timedOut
        ? {
            type: "stage_completed",
            runId,
            ts: Date.now(),
            stage,
            durationMs: outcome.durationMs,
            exitCode: outcome.exitCode,
          }
        : {
            type: "stage_failed",
            runId,
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
    storage.appendEvent({ type: "benchmark_finished", runId, ts: Date.now(), status, failedStage: stage });
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

  // D2-18: build output size, stack-agnostic dist/ walk.
  const distBytes = sumDirBytes(join(appDir, "dist"));

  // D2-14/D2-16: non-fatal metric stages — absent field = stage skipped,
  // a non-zero exit is recorded but never blocks the screenshot.
  for (const stage of ["lint", "test"] as const) {
    const command = stack[stage];
    if (!command) continue;
    await runAndRecordStage(stage, command, stage === "lint" ? lintTimeoutMs : testTimeoutMs);
  }

  // TEL-03: anchor the startup window so `start` folds like install/build.
  const startAt = Date.now();
  storage.appendEvent({ type: "stage_started", runId, ts: startAt, stage: "start" });
  const { subprocess } = startServer(stack.start, { cwd: appDir, env });
  try {
    const url = `http://localhost:${stack.port}`;
    // Race readiness against the subprocess's own exit to distinguish "died
    // before ever answering" (start_failed) from "never answered but may
    // still be running" (timeout, D2-13).
    const raceResult = await Promise.race([
      waitForHttp200(url, startTimeoutMs)
        .then((): "ready" | "readyTimeout" => "ready")
        .catch((): "ready" | "readyTimeout" => "readyTimeout"),
      subprocess.then(
        (): "exited" => "exited",
        (): "exited" => "exited",
      ),
    ]);

    if (raceResult !== "ready") {
      const status: RunStatus = raceResult === "exited" ? "start_failed" : "timeout";
      // TEL-03: close the startup window as failed so a start_failed/timeout run
      // still folds a startup duration (in addition to the terminal event).
      storage.appendEvent({ type: "stage_failed", runId, ts: Date.now(), stage: "start", durationMs: Date.now() - startAt, exitCode: 1 });
      storage.appendEvent({ type: "benchmark_finished", runId, ts: Date.now(), status, failedStage: "start" });
      cleanupWorkspace(runId, true, TMP_ROOT);
      storage.writeArtifact(runId, "meta", "meta.json", Buffer.from(JSON.stringify({ distBytes })));
      return { runId, status, failedStage: "start", screenshotArtifactId: null };
    }

    // TEL-03: server answered — close the startup window with its readiness duration.
    storage.appendEvent({ type: "stage_completed", runId, ts: Date.now(), stage: "start", durationMs: Date.now() - startAt, exitCode: 0 });

    // D5-13 gap #2 + TEL-03 render timing: renderWithPage keeps the browser/page
    // open (its own 12s navigation budget bounds it and it self-tears-down on a
    // navigation failure) so onLivePage can run axe against the agent's real app
    // before teardown. Time the pass with stage:'render'.
    const renderAt = Date.now();
    storage.appendEvent({ type: "stage_started", runId, ts: renderAt, stage: "render" });
    let renderResult: LiveRenderResult;
    try {
      renderResult = await renderWithPage({ url, viewport: stack.viewport });
    } catch {
      // renderWithPage already closed its own browser on a navigation failure.
      // Same start_failed classification as a dead server (BUILD-01, D2-15).
      storage.appendEvent({ type: "stage_failed", runId, ts: Date.now(), stage: "render", durationMs: Date.now() - renderAt, exitCode: 1 });
      storage.appendEvent({ type: "benchmark_finished", runId, ts: Date.now(), status: "start_failed", failedStage: "start" });
      cleanupWorkspace(runId, true, TMP_ROOT);
      storage.writeArtifact(runId, "meta", "meta.json", Buffer.from(JSON.stringify({ distBytes })));
      return { runId, status: "start_failed", failedStage: "start", screenshotArtifactId: null };
    }
    storage.appendEvent({ type: "stage_completed", runId, ts: Date.now(), stage: "render", durationMs: Date.now() - renderAt, exitCode: 0 });

    const screenshotArtifactId = storage.writeArtifact(runId, "screenshot", "generated.png", renderResult.png);
    storage.writeArtifact(
      runId,
      "meta",
      "meta.json",
      Buffer.from(
        JSON.stringify({
          distBytes,
          pageErrors: {
            consoleErrors: renderResult.consoleErrors,
            uncaughtExceptions: renderResult.uncaughtExceptions,
            failedRequests: renderResult.failedRequests,
          },
        }),
      ),
    );
    storage.appendEvent({ type: "benchmark_finished", runId, ts: Date.now(), status: "completed", failedStage: null });

    // D5-13 gap #2: yield the live page to the evaluator while the server is
    // STILL up (before the outer finally's killProcessTree) — that ordering is
    // the eval window's whole point. Always close the browser afterwards.
    try {
      if (opts?.onLivePage) await opts.onLivePage(renderResult.page, renderResult.png);
    } finally {
      await renderResult.close();
    }

    cleanupWorkspace(runId, false, TMP_ROOT);
    return { runId, status: "completed", failedStage: null, screenshotArtifactId };
  } finally {
    // WORK-04/T-2-03: guaranteed-once teardown on every exit path from this
    // block — success, start_failed, timeout, or an unexpected throw — and
    // always AFTER the onLivePage eval window closes.
    killProcessTree(subprocess);
  }
}
