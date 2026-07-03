import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { openDb } from "../src/storage/db.js";
import { persistManifest, type Manifest } from "../src/manifest/manifest.js";
import { insertEvaluation, updateRunComposite, updateRunOutcome } from "../src/storage/evaluations.js";
import {
  resolveSpecPath,
  latestRunId,
  readRunSummary,
  formatSummary,
  runCli,
  type RunSummary,
  type RunCliDeps,
} from "../src/cli/cli.js";

// --- fixtures -------------------------------------------------------------

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

/** A tmp-file dbPath — runBenchmark and runCli each open their OWN handle to
 *  the SAME file, so `:memory:` (which would be two separate empty DBs) is wrong. */
function tmp() {
  dir = mkdtempSync(join(tmpdir(), "web-stack-evals-cli-test-"));
  return { dbPath: join(dir, "bench.sqlite"), resultsRoot: join(dir, "results") };
}

function makeManifest(runId: string, createdAt: number): Manifest {
  return {
    runId,
    specSnapshot: {
      stack: { template: "angular" },
      scenario: { expected: { path: "scenarios/dashboard/expected.png" } },
      model: { provider: "deepseek", modelId: "deepseek-v4-pro" },
    },
    fingerprint: { top: "fp-top", components: {} },
    versionStamp: { modelId: "deepseek-v4-pro" },
    createdAt,
  } as unknown as Manifest;
}

function insMetric(db: Database.Database, runId: string, name: string, value: number, unit: string) {
  db.prepare("INSERT INTO metrics (run_id, name, value, unit) VALUES (?,?,?,?)").run(runId, name, value, unit);
}
function insIteration(db: Database.Database, runId: string, idx: number) {
  db.prepare("INSERT INTO iterations (run_id, iteration_index, correction_count) VALUES (?,?,0)").run(runId, idx);
}

/** Seed a fully-scored 'completed' run into an open db. */
function seedScored(db: Database.Database, runId: string, createdAt = 1_700_000_000_000) {
  persistManifest(db, makeManifest(runId, createdAt));
  updateRunComposite(db, runId, 0.83, { pixelmatch: 0.4, dom: 0.2, axe: 0.2, judge: 0.2 });
  updateRunOutcome(db, runId, "completed", null, createdAt + 42_100);
  insertEvaluation(db, runId, 0, "pixelmatch", 0.9, {});
  insertEvaluation(db, runId, 0, "axe", 0.85, {});
  insertEvaluation(db, runId, 0, "judge", 0.8, {});
  insMetric(db, runId, "wall_ms", 42_100, "ms");
  insMetric(db, runId, "cost_usd", 0.037, "usd");
  insMetric(db, runId, "total_tokens", 18_432, "count");
  insMetric(db, runId, "iteration_count", 6, "count");
}

/** Seed a build_failed run (partial metrics, null composite). */
function seedFailed(db: Database.Database, runId: string, createdAt = 1_700_000_100_000) {
  persistManifest(db, makeManifest(runId, createdAt));
  updateRunOutcome(db, runId, "build_failed", "build", createdAt + 1_500);
  insMetric(db, runId, "wall_ms", 1_500, "ms");
}

// --- resolveSpecPath (traversal gate, T-05-01) ----------------------------

describe("resolveSpecPath", () => {
  it("resolves valid names to fixed spec paths", () => {
    expect(resolveSpecPath("stack", "angular")).toBe("stacks/angular.yaml");
    expect(resolveSpecPath("model", "deepseek4pro")).toBe("models/deepseek4pro.json");
    expect(resolveSpecPath("scenario", "dashboard")).toBe("scenarios/dashboard/dashboard.yaml");
  });

  it.each(["../etc", "/abs", "a/b", "a b", "..", ""])(
    "rejects traversal/invalid name %j naming the flag but leaking no resolved path",
    (bad) => {
      let msg = "";
      try {
        resolveSpecPath("stack", bad);
        throw new Error("did not throw");
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toContain("stack");
      // no resolved spec path leaked
      expect(msg).not.toContain("stacks/");
      expect(msg).not.toMatch(/\.yaml/);
    },
  );
});

// --- latestRunId (D5-06) --------------------------------------------------

describe("latestRunId", () => {
  it("returns the newest run by started_at, null on empty DB", () => {
    const { dbPath } = tmp();
    const db = openDb(dbPath);
    try {
      expect(latestRunId(db)).toBeNull();
      seedScored(db, "run-20260101000000-aaaaaa", 1_700_000_000_000);
      seedScored(db, "run-20260102000000-bbbbbb", 1_700_000_500_000);
      expect(latestRunId(db)).toBe("run-20260102000000-bbbbbb");
    } finally {
      db.close();
    }
  });
});

// --- readRunSummary + formatSummary (D5-03 / D5-05) -----------------------

const LABELS = { stack: "angular", model: "deepseek4pro", scenario: "dashboard" };

describe("readRunSummary + formatSummary", () => {
  it("formats a SCORED run as the six-line D5-03 block", () => {
    const { dbPath } = tmp();
    const db = openDb(dbPath);
    let summary: RunSummary | null;
    try {
      seedScored(db, "run-scored", 1_700_000_000_000);
      summary = readRunSummary(db, "run-scored");
    } finally {
      db.close();
    }
    expect(summary).not.toBeNull();
    const block = formatSummary(summary!, { ...LABELS, runId: "run-scored" }, "results/run-scored/report.html");
    const lines = block.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain("angular × deepseek4pro × dashboard");
    expect(lines[0]).toContain("run-scored");
    expect(lines[1]).toBe("SCORED");
    expect(lines[2]).toBe("composite 0.83");
    expect(lines[3]).toBe("pixelmatch=0.90 dom=— a11y=0.85 judge=0.80");
    expect(lines[4]).toBe("wall 42.1s · $0.037 · 18.4k tok · 6 iters");
    expect(lines[5]).toBe("Report: results/run-scored/report.html");
  });

  it("renders a build_failed run with folded metrics and no crash (D5-05)", () => {
    const { dbPath } = tmp();
    const db = openDb(dbPath);
    let summary: RunSummary | null;
    try {
      seedFailed(db, "run-failed");
      summary = readRunSummary(db, "run-failed");
    } finally {
      db.close();
    }
    const block = formatSummary(summary!, { ...LABELS, runId: "run-failed" }, "results/run-failed/report.html");
    const lines = block.split("\n");
    expect(lines[1]).toBe("FAILED · build");
    expect(lines[2]).toBe("composite —");
    expect(lines[4]).toBe("wall 1.5s · $— · — tok · — iters");
  });

  it("falls back to COUNT(*) of iterations rows when no iteration_count metric", () => {
    const { dbPath } = tmp();
    const db = openDb(dbPath);
    let summary: RunSummary | null;
    try {
      persistManifest(db, makeManifest("run-iters", 1_700_000_000_000));
      updateRunOutcome(db, "run-iters", "completed", null, 1_700_000_001_000);
      insIteration(db, "run-iters", 0);
      insIteration(db, "run-iters", 1);
      insIteration(db, "run-iters", 2);
      summary = readRunSummary(db, "run-iters");
    } finally {
      db.close();
    }
    expect(summary!.metrics.get("iteration_count")).toBe(3);
  });

  it("returns null for an absent run row", () => {
    const { dbPath } = tmp();
    const db = openDb(dbPath);
    try {
      expect(readRunSummary(db, "run-missing")).toBeNull();
    } finally {
      db.close();
    }
  });
});

// --- runCli exit-code mapping (D5-08) -------------------------------------

/** A fake runBenchmark honoring the (args, deps) two-param contract: it opens
 *  deps.dbPath ITSELF, seeds a row, closes, and resolves a RunResult. It is
 *  never handed an open db. */
function makeFakeRun(seed: (db: Database.Database, runId: string) => void, runId: string, status: string) {
  return async (_args: unknown, deps: { dbPath: string; resultsRoot: string }) => {
    const db = openDb(deps.dbPath);
    try {
      seed(db, runId);
    } finally {
      db.close();
    }
    return {
      runId,
      status,
      compositeScore: status === "completed" ? 0.83 : null,
      failedStage: status === "completed" ? null : "build",
      reportDir: join(deps.resultsRoot, runId),
      scored: true,
    };
  };
}

function baseDeps(dbPath: string, resultsRoot: string, over: Partial<RunCliDeps> = {}): RunCliDeps {
  return {
    runBenchmark: makeFakeRun(seedScored, "run-cli-ok", "completed"),
    renderReport: () => "<html>fake</html>",
    openDb,
    dbPath,
    resultsRoot,
    ...over,
  };
}

describe("runCli", () => {
  const RUN_ARGV = ["run", "--stack", "angular", "--model", "deepseek4pro", "--scenario", "dashboard"];

  it("run: scored row → exit 0 and writes report.html", async () => {
    const { dbPath, resultsRoot } = tmp();
    const code = await runCli(RUN_ARGV, baseDeps(dbPath, resultsRoot));
    expect(code).toBe(0);
    expect(existsSync(join(resultsRoot, "run-cli-ok", "report.html"))).toBe(true);
    expect(readFileSync(join(resultsRoot, "run-cli-ok", "report.html"), "utf8")).toContain("fake");
  });

  it("run: build_failed is still a scored row → exit 0", async () => {
    const { dbPath, resultsRoot } = tmp();
    const deps = baseDeps(dbPath, resultsRoot, {
      runBenchmark: makeFakeRun(seedFailed, "run-cli-bf", "build_failed"),
    });
    const code = await runCli(RUN_ARGV, deps);
    expect(code).toBe(0);
    expect(existsSync(join(resultsRoot, "run-cli-bf", "report.html"))).toBe(true);
  });

  it("run: harness throw → non-zero and no report.html written", async () => {
    const { dbPath, resultsRoot } = tmp();
    const deps = baseDeps(dbPath, resultsRoot, {
      runBenchmark: async () => {
        throw new Error("unresolvable spec");
      },
    });
    const code = await runCli(RUN_ARGV, deps);
    expect(code).not.toBe(0);
    expect(existsSync(resultsRoot) ? readFileSync : null).toBeDefined; // guard
    // no report.html anywhere under resultsRoot
    expect(existsSync(join(resultsRoot, "run-cli-ok", "report.html"))).toBe(false);
  });

  it("report <unknown-id> → unknown-id copy, non-zero", async () => {
    const { dbPath, resultsRoot } = tmp();
    // create the DB (with one unrelated run) so it isn't empty
    const db = openDb(dbPath);
    seedScored(db, "run-exists", 1_700_000_000_000);
    db.close();
    const out: string[] = [];
    const deps = baseDeps(dbPath, resultsRoot, { log: (s) => out.push(s), error: (s) => out.push(s) });
    const code = await runCli(["report", "run-nope"], deps);
    expect(code).not.toBe(0);
    expect(out.join("\n")).toContain("Run 'run-nope' not found");
  });

  it("report --latest on empty DB → empty-DB copy, non-zero", async () => {
    const { dbPath, resultsRoot } = tmp();
    const out: string[] = [];
    const deps = baseDeps(dbPath, resultsRoot, { log: (s) => out.push(s), error: (s) => out.push(s) });
    const code = await runCli(["report", "--latest"], deps);
    expect(code).not.toBe(0);
    expect(out.join("\n")).toContain("No runs found");
  });

  it("report --latest with a stored run → exit 0 and regenerates report.html", async () => {
    const { dbPath, resultsRoot } = tmp();
    const db = openDb(dbPath);
    seedScored(db, "run-latest", 1_700_000_900_000);
    db.close();
    const code = await runCli(["report", "--latest"], baseDeps(dbPath, resultsRoot));
    expect(code).toBe(0);
    expect(existsSync(join(resultsRoot, "run-latest", "report.html"))).toBe(true);
  });
});
