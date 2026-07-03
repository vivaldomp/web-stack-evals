// The testable core of the `bench` CLI (CLI-01 / CLI-02 / REPORT-01). Pure and
// paid-call-free: it imports NO orchestrator and NO report renderer — both arrive
// via injected `deps`, so this module is unit-testable with fakes and never makes
// a network/paid call. The bin shim (index.ts) is the sole owner of the real
// runBenchmark/renderReport imports and of process.exit.
//
// Responsibilities are deliberately thin (D-23): arg parsing, the path-traversal
// gate (T-05-01), bound-param reads, and terminal-summary formatting. Every fold /
// score / HTML render lives upstream.
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";

const MIDDOT = "·";
const EM_DASH = "—";

// ---------------------------------------------------------------------------
// (1) resolveSpecPath — the path-traversal gate (T-05-01 / D5-02).
// ---------------------------------------------------------------------------

const SPEC_NAME = /^[A-Za-z0-9_-]+$/;

/**
 * Validate a spec-flag value against a safe charset BEFORE constructing any path,
 * then return the FIXED relative spec path per kind. Rejects `/`, `.`, `..`,
 * whitespace, and empty — the error names the flag but leaks no resolved path
 * (T-05-01). `stack`→`stacks/<name>.yaml`, `model`→`models/<name>.json`,
 * `scenario`→`scenarios/<name>/<name>.yaml`.
 */
export function resolveSpecPath(kind: "stack" | "model" | "scenario", name: string | undefined): string {
  if (!name || !SPEC_NAME.test(name)) {
    throw new Error(`Invalid --${kind}: expected a plain name matching [A-Za-z0-9_-] (no paths, slashes, dots, or spaces).`);
  }
  switch (kind) {
    case "stack":
      return `stacks/${name}.yaml`;
    case "model":
      return `models/${name}.json`;
    case "scenario":
      return `scenarios/${name}/${name}.yaml`;
  }
}

// ---------------------------------------------------------------------------
// (2) readRunSummary — bound-param reads folded into a RunSummary.
// ---------------------------------------------------------------------------

export interface RunSummary {
  status: string;
  failedStage: string | null;
  composite: number | null;
  /** evaluator_name → raw_score (a11y label maps to the `axe` key). */
  subScores: Map<string, number | null>;
  /** metric name → value; `iteration_count` is resolved (metric or COUNT(*) rows). */
  metrics: Map<string, number>;
  /** Manifest-derived display names (specs carry no `name` field). */
  names: { stack: string; model: string; scenario: string };
}

function scenarioNameFrom(expectedPath: string | undefined): string {
  if (!expectedPath) return "scenario";
  const parts = expectedPath.split(/[\\/]/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[parts.length - 1] ?? "scenario");
}

function namesFromManifest(manifestJson: string | null): RunSummary["names"] {
  const names = { stack: "stack", model: "model", scenario: "scenario" };
  if (!manifestJson) return names;
  try {
    const m = JSON.parse(manifestJson);
    names.stack = m?.specSnapshot?.stack?.template ?? names.stack;
    names.model = m?.versionStamp?.modelId ?? m?.specSnapshot?.model?.modelId ?? names.model;
    names.scenario = scenarioNameFrom(m?.specSnapshot?.scenario?.expected?.path);
  } catch {
    // malformed manifest never crashes the summary (D5-05)
  }
  return names;
}

export function readRunSummary(db: Database.Database, runId: string): RunSummary | null {
  const run = db
    .prepare("SELECT status, failed_stage, composite_score, manifest FROM runs WHERE run_id = @run_id")
    .get({ run_id: runId }) as
    | { status: string | null; failed_stage: string | null; composite_score: number | null; manifest: string | null }
    | undefined;
  if (!run) return null;

  const subScores = new Map<string, number | null>();
  for (const r of db
    .prepare("SELECT evaluator_name, raw_score FROM evaluations WHERE run_id = @run_id")
    .all({ run_id: runId }) as { evaluator_name: string; raw_score: number | null }[]) {
    subScores.set(r.evaluator_name, r.raw_score);
  }

  const metrics = new Map<string, number>();
  for (const r of db
    .prepare("SELECT name, value FROM metrics WHERE run_id = @run_id")
    .all({ run_id: runId }) as { name: string; value: number }[]) {
    metrics.set(r.name, r.value);
  }
  // iteration_count fallback: COUNT(*) of iterations rows when no folded metric.
  if (!metrics.has("iteration_count")) {
    const { n } = db
      .prepare("SELECT COUNT(*) AS n FROM iterations WHERE run_id = @run_id")
      .get({ run_id: runId }) as { n: number };
    if (n > 0) metrics.set("iteration_count", n);
  }

  return {
    status: run.status ?? "unknown",
    failedStage: run.failed_stage,
    composite: run.composite_score,
    subScores,
    metrics,
    names: namesFromManifest(run.manifest),
  };
}

// ---------------------------------------------------------------------------
// (3) latestRunId — newest run by started_at (D5-06).
// ---------------------------------------------------------------------------

export function latestRunId(db: Database.Database): string | null {
  const row = db.prepare("SELECT run_id FROM runs ORDER BY started_at DESC LIMIT 1").get() as
    | { run_id: string }
    | undefined;
  return row?.run_id ?? null;
}

// ---------------------------------------------------------------------------
// (4) formatSummary — the D5-03 six-line terminal block.
// ---------------------------------------------------------------------------

const SUB_SCORES: { key: string; label: string }[] = [
  { key: "pixelmatch", label: "pixelmatch" },
  { key: "dom", label: "dom" },
  { key: "axe", label: "a11y" },
  { key: "judge", label: "judge" },
];

function statusPill(status: string, failedStage: string | null): string {
  if (status === "completed") return "SCORED";
  if (status === "timeout") return `CAPPED ${MIDDOT} timeout`;
  return `FAILED ${MIDDOT} ${failedStage ?? "unknown"}`;
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** The compact D5-03 block. Rounding is presentation-only (D-26); a failed/capped
 *  run still renders whatever metrics folded (D5-05) — never a crash. */
export function formatSummary(
  summary: RunSummary,
  labels: { stack: string; model: string; scenario: string; runId: string },
  reportPath: string,
): string {
  const header = `${labels.stack} × ${labels.model} × ${labels.scenario}  ${labels.runId}`;
  const pill = statusPill(summary.status, summary.failedStage);
  const composite = summary.composite == null ? EM_DASH : summary.composite.toFixed(2);
  const subs = SUB_SCORES.map(({ key, label }) => {
    const v = summary.subScores.has(key) ? summary.subScores.get(key) : undefined;
    return `${label}=${v == null ? EM_DASH : v.toFixed(2)}`;
  }).join(" ");

  const wall = summary.metrics.has("wall_ms") ? `wall ${(summary.metrics.get("wall_ms")! / 1000).toFixed(1)}s` : `wall ${EM_DASH}`;
  const cost = summary.metrics.has("cost_usd") ? `$${summary.metrics.get("cost_usd")!.toFixed(3)}` : `$${EM_DASH}`;
  const tok = `${summary.metrics.has("total_tokens") ? fmtTokens(summary.metrics.get("total_tokens")!) : EM_DASH} tok`;
  const iters = `${summary.metrics.has("iteration_count") ? summary.metrics.get("iteration_count")! : EM_DASH} iters`;
  const headline = [wall, cost, tok, iters].join(` ${MIDDOT} `);

  return [header, pill, `composite ${composite}`, subs, headline, `Report: ${reportPath}`].join("\n");
}

// ---------------------------------------------------------------------------
// (5) runCli — parse the subcommand, wire injected deps, map exit codes (D5-08).
// ---------------------------------------------------------------------------

export interface RunBenchmarkResult {
  runId: string;
  status: string;
  compositeScore: number | null;
  failedStage: string | null;
  reportDir: string;
  scored: boolean;
}

export type RunBenchmarkFn = (
  args: { stackPath: string; modelPath: string; scenarioPath: string },
  deps: { dbPath: string; resultsRoot: string },
) => Promise<RunBenchmarkResult>;

export type RenderReportFn = (db: Database.Database, runId: string, resultsRoot?: string) => string;

export interface RunCliDeps {
  runBenchmark: RunBenchmarkFn;
  renderReport: RenderReportFn;
  openDb: (file: string) => Database.Database;
  dbPath: string;
  resultsRoot: string;
  log?: (s: string) => void;
  error?: (s: string) => void;
}

/** Render + write results/<runId>/report.html via the injected renderer; echo path (D5-07). */
function emitReport(deps: RunCliDeps, db: Database.Database, runId: string): string {
  const html = deps.renderReport(db, runId, deps.resultsRoot);
  const outDir = join(deps.resultsRoot, runId);
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "report.html");
  writeFileSync(path, html);
  return path;
}

function cleanMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * `run` executes one benchmark and prints the summary; `report [<id>] [--latest]`
 * regenerates a stored run's summary + report.html. Returns the exit code — it
 * NEVER calls process.exit (that stays in index.ts). Any scored row → 0; a harness
 * throw / unknown-id / empty-DB → non-zero (D5-08).
 */
export async function runCli(argv: string[], deps: RunCliDeps): Promise<number> {
  const log = deps.log ?? ((s: string) => console.log(s));
  const error = deps.error ?? ((s: string) => console.error(s));
  const [subcommand, ...rest] = argv;

  if (subcommand === "run") {
    try {
      const { values } = parseArgs({
        args: rest,
        options: { stack: { type: "string" }, model: { type: "string" }, scenario: { type: "string" } },
        allowPositionals: false,
      });
      const stackPath = resolveSpecPath("stack", values.stack);
      const modelPath = resolveSpecPath("model", values.model);
      const scenarioPath = resolveSpecPath("scenario", values.scenario);
      // runBenchmark opens+closes its OWN db from deps.dbPath — pass the (args, deps) pair, never a handle.
      const result = await deps.runBenchmark(
        { stackPath, modelPath, scenarioPath },
        { dbPath: deps.dbPath, resultsRoot: deps.resultsRoot },
      );
      const db = deps.openDb(deps.dbPath);
      try {
        const summary = readRunSummary(db, result.runId);
        if (!summary) throw new Error(`Scored run ${result.runId} is missing from the results DB.`);
        const reportPath = emitReport(deps, db, result.runId);
        log(
          formatSummary(
            summary,
            { stack: values.stack!, model: values.model!, scenario: values.scenario!, runId: result.runId },
            reportPath,
          ),
        );
      } finally {
        db.close();
      }
      return 0;
    } catch (e) {
      error(cleanMessage(e));
      return 1;
    }
  }

  if (subcommand === "report") {
    const { positionals } = parseArgs({
      args: rest,
      options: { latest: { type: "boolean" } },
      allowPositionals: true,
    });
    const db = deps.openDb(deps.dbPath);
    try {
      const target = positionals[0] ?? latestRunId(db);
      if (!target) {
        error("No runs found. Run `bench run --stack … --model … --scenario …` to produce one.");
        return 1;
      }
      const summary = readRunSummary(db, target);
      if (!summary) {
        error(
          `Run '${target}' not found. Run \`bench run --stack … --model … --scenario …\` first, or \`bench report --latest\`.`,
        );
        return 1;
      }
      const reportPath = emitReport(deps, db, target);
      log(
        formatSummary(
          summary,
          { stack: summary.names.stack, model: summary.names.model, scenario: summary.names.scenario, runId: target },
          reportPath,
        ),
      );
      return 0;
    } finally {
      db.close();
    }
  }

  error("Usage: bench <run --stack <s> --model <m> --scenario <sc> | report [<run_id>] [--latest]>");
  return 1;
}
