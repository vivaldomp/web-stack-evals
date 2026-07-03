// CLI-01 / SC#1: the single sequencing function that turns three named spec
// paths into one stored, scored benchmark row. It is deliberately headless —
// returns a structured RunResult and prints nothing (the terminal summary is
// 05-07's job, the HTML report is 05-05's). Every prior phase lives behind a
// port precisely so this file is glue, not new capability.
//
// D-23 import hygiene (enforced by tests/importBoundary.test.ts + grep gates):
// this module imports only port/pipeline/eval/agent/spec/manifest/workspace
// helpers + storage functions + the LLM layer (@earendil-works/pi-ai, which is
// allowed; only the Pi coding-agent SDK is boundary-guarded). It never imports
// that SDK (the image probe is encapsulated in 05-02), a
// browser (the live page flows through as `unknown`), or reaches raw SQL — every
// read/write goes through a storage/eval helper.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import type { Models } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { loadStack, loadScenario, loadModel } from "../specs/load.js";
import type { Stack } from "../specs/types.js";
import { newRunId } from "../core/ids.js";
import type { RunStatus } from "../core/events.js";
import type { StoragePort } from "../core/ports.js";
import { buildManifest, persistManifest, type VersionStamp } from "../manifest/manifest.js";
import { sha256 } from "../manifest/fingerprint.js";
import { openDb } from "../storage/db.js";
import { createStoragePort } from "../storage/storagePort.js";
import { updateRunOutcome, linkExpectedScreenshot } from "../storage/evaluations.js";
import { projectMetrics } from "../telemetry/projectMetrics.js";
import { runSession, type SessionFactory } from "../agent/piAgentAdapter.js";
import type { AgentInput, AgentModelSpec } from "../agent/types.js";
import { modelAcceptsImage } from "../agent/modelCapabilities.js";
import { copyWorkspace } from "../workspace/copy.js";
import { runStack, type RunOutcome } from "../pipeline/runStack.js";
import { evaluateRun } from "../pipeline/evaluate.js";
import { DEFAULT_EVALUATOR_WEIGHTS } from "../pipeline/composite.js";
import { buildRegistry } from "../eval/registry.js";
import { DEFAULT_JUDGE_MODEL } from "../eval/judgeEvaluator.js";

export interface RunBenchmarkArgs {
  stackPath: string;
  modelPath: string;
  scenarioPath: string;
}

/** The live-page eval window handed to buildRender. Object-shaped so run.ts is
 * isolated from 05-01's positional `onLivePage(page, generatedPng)` signature. */
export type OnLivePage = (live: { generatedPng: Buffer; page: unknown }) => Promise<void>;

/** The build/render seam. Default = {@link defaultBuildRender} over runStack;
 * tests inject a fake that chooses the RunOutcome without a real Angular build. */
export type BuildRenderFn = (input: {
  stack: Stack;
  runId: string;
  storage: StoragePort;
  appDir: string;
  onLivePage: OnLivePage;
}) => Promise<RunOutcome>;

export interface RunBenchmarkDeps {
  createSession?: SessionFactory;
  buildRender?: BuildRenderFn;
  models?: Models;
  dbPath?: string;
  resultsRoot?: string;
  now?: () => number;
}

export interface RunResult {
  runId: string;
  status: RunStatus;
  compositeScore: number | null;
  failedStage: string | null;
  reportDir: string;
  scored: boolean;
}

/** Production model registry: the built-in pi-ai provider catalog (loads the
 * real anthropic provider so buildRegistry's getModel resolves the judge). The
 * key is read from env only at models.complete() time inside the judge — absent
 * → the judge drops and the composite renormalizes, never a crash (D5-05). */
function defaultModels(): Models {
  return builtinModels();
}

/** ≤5-line adapter over 05-01's EXISTING runStack build/render entry. Under
 * prePopulated:true runStack derives appDir itself (the dir run.ts pre-populated
 * at step 6), so appDir is not forwarded. Bridges 05-01's positional callback to
 * the object-shaped {@link OnLivePage} seam. runStack never rejects for a scored
 * failure, so the returned RunOutcome carries the terminal status directly. */
const defaultBuildRender: BuildRenderFn = ({ stack, runId, storage, onLivePage }) =>
  runStack(stack, runId, storage, {
    prePopulated: true,
    onLivePage: (page, generatedPng) => onLivePage({ generatedPng, page }),
  });

/** Best-effort Playwright version from its package.json — a file read, NOT a
 * runtime browser import (keeps run.ts out of the D-23 playwright boundary). */
function readPlaywrightVersion(): string | null {
  try {
    return (JSON.parse(readFileSync("node_modules/playwright/package.json", "utf8")) as { version: string }).version;
  } catch {
    return null;
  }
}

/**
 * The 05-RESEARCH §Orchestrator 13-step sequence: load → build/persist manifest
 * (run_id) → agent stream into the SAME run log → build/render on the
 * agent-populated workspace → evaluate+score (completed path only) →
 * updateRunOutcome → projectMetrics → return a scored RunResult. Throws ONLY on
 * harness-fatal conditions (unresolvable/invalid spec, missing asset file, DB
 * open/write error, agent setup throw) so the CLI maps return→exit 0,
 * throw→non-zero (D5-08). Any reached return means a scored row persisted.
 */
export async function runBenchmark(args: RunBenchmarkArgs, deps: RunBenchmarkDeps = {}): Promise<RunResult> {
  // 1. HARNESS-FATAL prologue — any throw here propagates (→ CLI non-zero, no row).
  const stack = loadStack(args.stackPath);
  const scenario = loadScenario(args.scenarioPath);
  const model = loadModel(args.modelPath);
  const scenarioDir = dirname(args.scenarioPath);
  const expectedPng = readFileSync(join(scenarioDir, scenario.expected.path));
  const mockupBytes = readFileSync(join(scenarioDir, "mockup.png"));
  const runId = newRunId();

  const dbPath = deps.dbPath ?? "results/bench.sqlite";
  const resultsRoot = deps.resultsRoot ?? "results";
  const now = deps.now ?? Date.now;
  const models = deps.models ?? defaultModels();
  const buildRender = deps.buildRender ?? defaultBuildRender;

  // 2. Open the results DB (WAL via openDb); close it in the finally.
  const db: Database.Database = openDb(dbPath);
  try {
    const storage = createStoragePort(db, resultsRoot);

    // 3. Version stamp (no browser / Pi runtime import) + manifest → runs row 'pending'.
    const versionStamp: VersionStamp = {
      node: process.version,
      dependencies: { lockfileHash: sha256(readFileSync("package-lock.json")) },
      playwright: readPlaywrightVersion(),
      chromium: null, // ponytail: best-effort v1; real chromium revision later.
      modelId: model.modelId,
      modelParams: model.params,
    };
    const manifest = buildManifest({
      runId,
      stack,
      scenario,
      model,
      prompt: scenario.prompt,
      mockup: mockupBytes,
      expected: expectedPng,
      skills: undefined,
      versionStamp,
    });
    persistManifest(db, manifest); // DB write failure here is harness-fatal.

    // 4. Persist the expected screenshot NOW so `report` shows it even on a
    //    failed row (A7 / D5-15 iii) — independent of the run outcome.
    linkExpectedScreenshot(db, runId, expectedPng, stack.viewport, resultsRoot);

    // 5. Image gate (D5-01/D5-14): a text-only model skips the mockup and records
    //    the caveat marker the 05-05 report reads.
    const agentModel: AgentModelSpec = {
      provider: model.provider,
      modelId: model.modelId,
      thinkingLevel: model.params.thinkingLevel as AgentModelSpec["thinkingLevel"],
      temperature: (model.params.temperature as number | undefined) ?? 0,
    };
    const injectImage = modelAcceptsImage(agentModel);
    if (!injectImage) {
      storage.appendEvent({
        runId,
        ts: now(),
        type: "unknown",
        piType: "mockup_grounding_skipped",
        raw: { reason: "model does not accept image input" },
      });
    }

    // 6. Seed the disposable workspace + build the agent input.
    const appDir = copyWorkspace(stack.template, runId, "tmp");
    const agentInput: AgentInput = {
      runId,
      workspacePath: appDir,
      promptText: scenario.prompt,
      preamble: stack.preamble,
      mockupBytes,
      mockupMimeType: "image/png",
      skillPaths: scenario.skills,
      model: agentModel,
      budget: {
        maxWallClockMs: scenario.budget.maxMinutes * 60000,
        maxCostUsd: scenario.budget.maxUsd,
        maxTurns: scenario.budget.maxTurns,
      },
      injectImage,
    };

    // 7. AGENT-FIRST stream into the shared log. A THROW out of runSession is a
    //    setup failure with no agent terminal → propagate as harness-fatal (D5-08).
    let agentTerminal: RunStatus | null = null;
    for await (const draft of runSession(agentInput, { createSession: deps.createSession, now: deps.now })) {
      storage.appendEvent(draft);
      if (draft.type === "benchmark_finished") agentTerminal = draft.status;
    }

    // 8. Terminal-status branch (honors D4-21 "one terminal").
    let status: RunStatus;
    let failedStage: string | null;
    let compositeScore: number | null = null;

    if (agentTerminal !== null) {
      // The agent already emitted the authoritative terminal (capped/errored) —
      // do NOT call buildRender (that would double-emit). No screenshot, no eval.
      status = agentTerminal;
      failedStage = null;
    } else {
      // Natural completion: build/render on the agent-populated workspace and
      // evaluate ONLY inside the server-up onLivePage window (completed path).
      const onLivePage: OnLivePage = async (live) => {
        try {
          const registry = buildRegistry({
            db,
            models,
            expectedElements: scenario.expectedElements,
            judgeModel: DEFAULT_JUDGE_MODEL,
          });
          const evalResult = await evaluateRun({
            db,
            runId,
            repIndex: 0, // D5-10: one rep per unique run_id in v1.
            expectedPng,
            generatedPng: live.generatedPng,
            viewport: stack.viewport,
            page: live.page,
            registry,
            defaultWeights: scenario.evaluatorWeights ?? DEFAULT_EVALUATOR_WEIGHTS,
          });
          compositeScore = evalResult.compositeScore;
        } catch {
          // Any evaluator/registry throw leaves the row scored with a null
          // composite — never crashes the run (D5-05).
          compositeScore = null;
        }
      };
      const outcome = await buildRender({ stack, runId, storage, appDir, onLivePage });
      status = outcome.status;
      failedStage = outcome.failedStage;
    }

    // 9. Terminal-state write (gap #3) — else the row stays 'pending' forever.
    updateRunOutcome(db, runId, status, failedStage, now()); // DB failure here is harness-fatal.

    // 10. Fold metrics AFTER the run (TEL-02/D-24) — never inline during the stream.
    projectMetrics(db, runId);

    // 11. Any reached return means a scored row persisted → CLI exit 0 (D5-08).
    return {
      runId,
      status,
      compositeScore,
      failedStage,
      reportDir: join(resultsRoot, runId),
      scored: true,
    };
  } finally {
    db.close();
  }
}
