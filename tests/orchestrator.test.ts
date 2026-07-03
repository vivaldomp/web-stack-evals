// Wave-0 RED scaffold: pins the runBenchmark contract BEFORE src/orchestrator/run.ts
// exists (importing it fails until Task 2 lands — the expected RED state). Every
// dep is injected: a scripted fake Pi session (real runSession + mapper, zero
// network/cost), a fauxProvider judge (zero paid call), and a fake buildRender
// that chooses the RunOutcome — so the whole 13-step sequence is exercised with
// the happy path's renderWithPage the SOLE Chromium touch (cases 2-5 stay pure).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, type Models } from "@earendil-works/pi-ai";
import { openDb, readEvents } from "../src/storage/db.js";
import { renderWithPage } from "../src/render/renderWithPage.js";
import { DEFAULT_JUDGE_MODEL } from "../src/eval/judgeEvaluator.js";
import { fakeFactory } from "./_fakes/fakeSession.js";
import { makeGeneratedMatchPng } from "./fixtures/eval/pngFixtures.js";
import type { PiEvent } from "../src/agent/mapEvent.js";
import { runBenchmark, type BuildRenderFn } from "../src/orchestrator/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appHtmlUrl = `file://${join(__dirname, "fixtures/eval/app.html")}`;

const STACK_PATH = "stacks/angular.yaml";
const MODEL_PATH = "tests/fixtures/models/deepseek4pro.json";
const SCENARIO_PATH = "tests/fixtures/scenarios/dashboard/dashboard.yaml";
const SCENARIO_DIR = "tests/fixtures/scenarios/dashboard";

// --- fakes / fixtures -------------------------------------------------------

/** Faux judge provider registered under DEFAULT_JUDGE_MODEL's own ids, so the
 * real buildRegistry(DEFAULT_JUDGE_MODEL) resolves to a zero-network double. */
function fauxModels(): Models {
  const faux = fauxProvider({
    provider: DEFAULT_JUDGE_MODEL.provider,
    models: [{ id: DEFAULT_JUDGE_MODEL.modelId, input: ["text", "image"] }],
  });
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("submit_verdict", {
          layoutFidelity: 0.9,
          componentPresence: 0.8,
          visualStylingFidelity: 0.7,
          rationale: "close match",
        }),
      ],
      { stopReason: "toolUse" },
    ),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  return models;
}

function usageTurnEnd(): PiEvent {
  return {
    type: "turn_end",
    message: {
      stopReason: "stop",
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 150, cost: { total: 0.0021 } },
    },
  };
}

/** Natural completion: session_started + first_token + 1 file_mutation + 2 usage,
 * NO agent terminal → the orchestrator proceeds to buildRender. */
const naturalScript: PiEvent[] = [
  { type: "agent_start" },
  { type: "message_update", assistantMessageEvent: { type: "text_delta" } },
  { type: "tool_execution_start", toolCallId: "t1", args: { path: "src/app.ts" } },
  { type: "tool_execution_end", toolCallId: "t1", toolName: "write", isError: false, result: { details: { linesAdded: 10, linesRemoved: 0 } } },
  usageTurnEnd(),
  usageTurnEnd(),
  { type: "agent_end" },
];

/** One turn against a maxTurns:1 budget → runSession trips the turns ceiling and
 * ends the stream with benchmark_finished{timeout}; buildRender must never run. */
const timeoutScript: PiEvent[] = [{ type: "agent_start" }, usageTurnEnd()];

const tmpDirs: string[] = [];
const runIds: string[] = [];

function freshRoots(): { dbPath: string; resultsRoot: string } {
  const dir = mkdtempSync(join(tmpdir(), "web-stack-evals-orchestrator-"));
  tmpDirs.push(dir);
  return { dbPath: join(dir, "bench.sqlite"), resultsRoot: join(dir, "results") };
}

/** A maxTurns-overriding scenario dir (clone of the dashboard fixture + the two
 * sibling PNGs) so the timeout ceiling trips on a single scripted turn. */
function scenarioWithMaxTurns(maxTurns: number): string {
  const dir = mkdtempSync(join(tmpdir(), "web-stack-evals-scenario-"));
  tmpDirs.push(dir);
  const yaml = [
    "prompt: |",
    "  Build a dashboard.",
    "expected:",
    "  path: expected.png",
    "  provenance:",
    "    source: hand-designed",
    "    tool: figma",
    '    version: "1.0"',
    '    date: "2026-06-15"',
    "viewport:",
    "  width: 1280",
    "  height: 800",
    "skills: []",
    "budget:",
    `  maxTurns: ${maxTurns}`,
    "",
  ].join("\n");
  writeFileSync(join(dir, "dashboard.yaml"), yaml);
  copyFileSync(join(SCENARIO_DIR, "expected.png"), join(dir, "expected.png"));
  copyFileSync(join(SCENARIO_DIR, "mockup.png"), join(dir, "mockup.png"));
  return join(dir, "dashboard.yaml");
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const id of runIds.splice(0)) rmSync(resolve("tmp", id), { recursive: true, force: true });
});

describe("runBenchmark (SC#1 / CLI-01 orchestration)", () => {
  it("HAPPY: completed run persists status + composite + projections + expected screenshot", async () => {
    const { dbPath, resultsRoot } = freshRoots();
    const { createSession } = fakeFactory(naturalScript);

    const buildRender: BuildRenderFn = async (input) => {
      const live = await renderWithPage({ url: appHtmlUrl, viewport: input.stack.viewport });
      try {
        await input.onLivePage({ generatedPng: makeGeneratedMatchPng(), page: live.page });
      } finally {
        await live.close();
      }
      return { runId: input.runId, status: "completed", failedStage: null, screenshotArtifactId: "art-generated" };
    };

    const result = await runBenchmark(
      { stackPath: STACK_PATH, modelPath: MODEL_PATH, scenarioPath: SCENARIO_PATH },
      { createSession, buildRender, models: fauxModels(), dbPath, resultsRoot },
    );
    runIds.push(result.runId);

    expect(result.status).toBe("completed");
    expect(result.scored).toBe(true);
    expect(typeof result.compositeScore).toBe("number");
    expect(result.compositeScore as number).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore as number).toBeLessThanOrEqual(1);
    expect(result.reportDir).toBe(join(resultsRoot, result.runId));

    const db = openDb(dbPath);
    const row = db.prepare("SELECT status, composite_score FROM runs WHERE run_id = ?").get(result.runId) as {
      status: string;
      composite_score: number | null;
    };
    expect(row.status).toBe("completed");
    expect(row.composite_score).not.toBeNull();

    const evalCount = (db.prepare("SELECT COUNT(*) c FROM evaluations WHERE run_id = ?").get(result.runId) as { c: number }).c;
    expect(evalCount).toBeGreaterThanOrEqual(1);

    for (const table of ["metrics", "tool_calls", "iterations"]) {
      const c = (db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE run_id = ?`).get(result.runId) as { c: number }).c;
      expect(c, `${table} should be populated`).toBeGreaterThan(0);
    }

    const expectedShot = db
      .prepare(
        `SELECT role FROM screenshots WHERE artifact_id IN (SELECT id FROM artifacts WHERE run_id = ?) AND role = 'expected'`,
      )
      .get(result.runId) as { role: string } | undefined;
    expect(expectedShot?.role).toBe("expected");
    db.close();
  }, 30_000);

  it("BUILD_FAILED: scored terminal row, no evaluation, partial metrics folded, never throws", async () => {
    const { dbPath, resultsRoot } = freshRoots();
    const { createSession } = fakeFactory(naturalScript);

    let onLivePageInvoked = false;
    const buildRender: BuildRenderFn = async (input) => {
      input.storage.appendEvent({ type: "stage_failed", runId: input.runId, ts: Date.now(), stage: "build", durationMs: 5, exitCode: 1 });
      input.storage.appendEvent({ type: "benchmark_finished", runId: input.runId, ts: Date.now(), status: "build_failed", failedStage: "build" });
      // deliberately does NOT call input.onLivePage
      void onLivePageInvoked;
      return { runId: input.runId, status: "build_failed", failedStage: "build", screenshotArtifactId: null };
    };

    const result = await runBenchmark(
      { stackPath: STACK_PATH, modelPath: MODEL_PATH, scenarioPath: SCENARIO_PATH },
      { createSession, buildRender, models: fauxModels(), dbPath, resultsRoot },
    );
    runIds.push(result.runId);

    expect(result.scored).toBe(true);
    expect(result.status).toBe("build_failed");
    expect(result.compositeScore).toBeNull();

    const db = openDb(dbPath);
    const row = db.prepare("SELECT status, failed_stage FROM runs WHERE run_id = ?").get(result.runId) as {
      status: string;
      failed_stage: string | null;
    };
    expect(row.status).toBe("build_failed");
    expect(row.failed_stage).toBe("build");

    const evalCount = (db.prepare("SELECT COUNT(*) c FROM evaluations WHERE run_id = ?").get(result.runId) as { c: number }).c;
    expect(evalCount).toBe(0);

    const metricCount = (db.prepare("SELECT COUNT(*) c FROM metrics WHERE run_id = ?").get(result.runId) as { c: number }).c;
    expect(metricCount).toBeGreaterThan(0);
    db.close();
  });

  it("TIMEOUT: agent-capped terminal skips buildRender, still scored, cost folded", async () => {
    const { dbPath, resultsRoot } = freshRoots();
    const { createSession } = fakeFactory(timeoutScript, { costPerTurn: 0.0021 });
    const scenarioPath = scenarioWithMaxTurns(1);

    let buildRenderCalls = 0;
    const buildRender: BuildRenderFn = async (input) => {
      buildRenderCalls++;
      return { runId: input.runId, status: "completed", failedStage: null, screenshotArtifactId: null };
    };

    const result = await runBenchmark(
      { stackPath: STACK_PATH, modelPath: MODEL_PATH, scenarioPath },
      { createSession, buildRender, models: fauxModels(), dbPath, resultsRoot },
    );
    runIds.push(result.runId);

    expect(buildRenderCalls).toBe(0);
    expect(result.status).toBe("timeout");
    expect(result.scored).toBe(true);

    const db = openDb(dbPath);
    const row = db.prepare("SELECT status FROM runs WHERE run_id = ?").get(result.runId) as { status: string };
    expect(row.status).toBe("timeout");
    const costRow = db.prepare("SELECT value FROM metrics WHERE run_id = ? AND name = 'cost_usd'").get(result.runId) as
      | { value: number }
      | undefined;
    expect(costRow?.value).toBeGreaterThan(0);
    db.close();
  });

  it("HARNESS ERROR: unresolvable scenario path rejects with no persisted row", async () => {
    const { dbPath, resultsRoot } = freshRoots();
    const { createSession } = fakeFactory(naturalScript);
    const buildRender: BuildRenderFn = async (input) => ({
      runId: input.runId,
      status: "completed",
      failedStage: null,
      screenshotArtifactId: null,
    });

    await expect(
      runBenchmark(
        { stackPath: STACK_PATH, modelPath: MODEL_PATH, scenarioPath: "tests/fixtures/scenarios/nope/nope.yaml" },
        { createSession, buildRender, models: fauxModels(), dbPath, resultsRoot },
      ),
    ).rejects.toThrow();
  });

  it("IMAGE GATE: a text-only model appends a mockup_grounding_skipped marker (D5-01/D5-14)", async () => {
    const { dbPath, resultsRoot } = freshRoots();
    const { createSession } = fakeFactory(naturalScript);
    const buildRender: BuildRenderFn = async (input) => {
      input.storage.appendEvent({ type: "benchmark_finished", runId: input.runId, ts: Date.now(), status: "build_failed", failedStage: "build" });
      return { runId: input.runId, status: "build_failed", failedStage: "build", screenshotArtifactId: null };
    };

    const result = await runBenchmark(
      { stackPath: STACK_PATH, modelPath: MODEL_PATH, scenarioPath: SCENARIO_PATH },
      { createSession, buildRender, models: fauxModels(), dbPath, resultsRoot },
    );
    runIds.push(result.runId);

    const db = openDb(dbPath);
    const events = readEvents(db, result.runId);
    const skipped = events.find((e) => e.type === "unknown" && e.piType === "mockup_grounding_skipped");
    expect(skipped, "mockup_grounding_skipped marker should be present for a text-only model").toBeDefined();
    db.close();
  });
});
