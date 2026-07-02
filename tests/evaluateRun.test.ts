// EVAL-05/SCORE-02 coverage: evaluateRun is the orchestrator that drives an
// injected EvaluatorPort[] registry over one shared input, persists every
// outcome (survivor or dropped) as its own evaluations row, links the
// pixelmatch diff screenshot, and writes the composite score only when at
// least one evaluator survived. This test file uses ONLY fake EvaluatorPort
// stand-ins -- it never imports a real evaluator module or Playwright.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDb } from "../src/storage/db.js";
import { evaluateRun } from "../src/pipeline/evaluate.js";
import type { EvaluatorPort } from "../src/core/ports.js";
import type Database from "better-sqlite3";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  // evaluateRun's linkDiffScreenshot call (per plan) uses writeArtifact's
  // default resultsRoot ("results" under cwd) -- clean up what it wrote.
  rmSync(resolve("results", "run-1"), { recursive: true, force: true });
});

function setup() {
  dir = mkdtempSync(join(tmpdir(), "web-stack-evals-evaluate-run-test-"));
  const db = openDb(join(dir, "results.sqlite"));
  db.prepare("INSERT INTO runs (run_id) VALUES (?)").run("run-1");
  return { db };
}

const viewport = { width: 100, height: 100 };

function baseInput(db: Database.Database, registry: EvaluatorPort[], overrides: Partial<Parameters<typeof evaluateRun>[0]> = {}) {
  return {
    db,
    runId: "run-1",
    repIndex: 0,
    expectedPng: Buffer.from("expected"),
    generatedPng: Buffer.from("generated"),
    viewport,
    page: {},
    registry,
    ...overrides,
  };
}

describe("evaluateRun (EVAL-05/SCORE-02)", () => {
  it("persists three evaluations rows and returns the renormalized composite over two survivors", async () => {
    const { db } = setup();
    const registry: EvaluatorPort[] = [
      { name: "fakeA", evaluate: async () => ({ rawScore: 0.8, detail: {} }) },
      { name: "fakeB", evaluate: async () => ({ rawScore: 0.6, detail: {} }) },
      { name: "fakeDropped", evaluate: async () => ({ rawScore: 0, detail: { dropped: true, reason: "boom" } }) },
    ];
    const defaultWeights = { fakeA: 1 / 3, fakeB: 1 / 3, fakeDropped: 1 / 3 };

    const result = await evaluateRun(baseInput(db, registry, { defaultWeights }));

    const rows = db
      .prepare("SELECT evaluator_name, raw_score, detail FROM evaluations WHERE run_id = ? ORDER BY evaluator_name")
      .all("run-1") as { evaluator_name: string; raw_score: number | null; detail: string }[];

    expect(rows).toHaveLength(3);
    const dropped = rows.find((r) => r.evaluator_name === "fakeDropped")!;
    expect(dropped.raw_score).toBeNull();
    expect(JSON.parse(dropped.detail).reason).toBe("boom");

    expect(result.compositeScore).toBeCloseTo((0.8 + 0.6) / 2, 10);

    const runRow = db.prepare("SELECT composite_score, composite_weights FROM runs WHERE run_id = ?").get("run-1") as {
      composite_score: number;
      composite_weights: string;
    };
    expect(runRow.composite_score).toBeCloseTo(result.compositeScore as number, 10);
    expect(JSON.parse(runRow.composite_weights)).toEqual(result.weightsUsed);

    db.close();
  });

  it("links the pixelmatch evaluator's diffPng as a screenshots.role='diff' artifact and no other evaluator triggers it", async () => {
    const { db } = setup();
    const diffPng = Buffer.from("fake-diff-png-bytes");
    const registry: EvaluatorPort[] = [
      { name: "pixelmatch", evaluate: async () => ({ rawScore: 0.9, detail: { diffPng } }) },
      { name: "fakeB", evaluate: async () => ({ rawScore: 0.5, detail: { diffPng: Buffer.from("should-not-link") } }) },
    ];

    await evaluateRun(baseInput(db, registry));

    const row = db
      .prepare(
        `SELECT role FROM screenshots WHERE artifact_id = (
           SELECT id FROM artifacts WHERE run_id = ? AND kind = 'screenshot' ORDER BY id DESC LIMIT 1
         )`,
      )
      .get("run-1") as { role: string } | undefined;

    expect(row?.role).toBe("diff");

    const screenshotCount = db.prepare("SELECT COUNT(*) as c FROM screenshots").get() as { c: number };
    expect(screenshotCount.c).toBe(1);

    db.close();
  });

  it("returns compositeScore null and leaves runs.composite_score untouched when every evaluator drops", async () => {
    const { db } = setup();
    const registry: EvaluatorPort[] = [
      { name: "fakeA", evaluate: async () => ({ rawScore: 0, detail: { dropped: true, reason: "render failed" } }) },
      { name: "fakeB", evaluate: async () => ({ rawScore: 0, detail: { dropped: true, reason: "timeout" } }) },
    ];

    const result = await evaluateRun(baseInput(db, registry));

    expect(result.compositeScore).toBeNull();

    const runRow = db.prepare("SELECT composite_score FROM runs WHERE run_id = ?").get("run-1") as {
      composite_score: number | null;
    };
    expect(runRow.composite_score).toBeNull();

    db.close();
  });

  it("calls every registry entry's evaluate() with the exact same shared input, regardless of evaluator name", async () => {
    const { db } = setup();
    const received: unknown[] = [];
    const registry: EvaluatorPort[] = [
      {
        name: "fakeA",
        evaluate: async (input: unknown) => {
          received.push(input);
          return { rawScore: 0.5, detail: {} };
        },
      },
      {
        name: "fakeB",
        evaluate: async (input: unknown) => {
          received.push(input);
          return { rawScore: 0.5, detail: {} };
        },
      },
    ];

    await evaluateRun(baseInput(db, registry));

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(received[1]);
    expect(received[0]).toEqual({
      expectedPng: Buffer.from("expected"),
      generatedPng: Buffer.from("generated"),
      viewport,
      page: {},
    });

    db.close();
  });
});
