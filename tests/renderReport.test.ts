import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { openDb, appendEvent } from "../src/storage/db.js";
import { persistManifest, type Manifest } from "../src/manifest/manifest.js";
import {
  insertEvaluation,
  updateRunComposite,
  updateRunOutcome,
  linkDiffScreenshot,
  linkExpectedScreenshot,
} from "../src/storage/evaluations.js";
import { writeArtifact } from "../src/storage/artifacts.js";
import { renderReport } from "../src/reports/renderReport.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  dir = mkdtempSync(join(tmpdir(), "web-stack-evals-report-test-"));
  const db = openDb(join(dir, "results.sqlite"));
  const resultsRoot = join(dir, "results");
  return { db, resultsRoot };
}

// Minimal Manifest fixture — the report reads only specSnapshot.stack.template,
// versionStamp.modelId, scenario.expected.path, plus the runs row columns.
function makeManifest(runId: string): Manifest {
  return {
    runId,
    specSnapshot: {
      stack: { template: "angular" },
      scenario: { expected: { path: "scenarios/landing/expected.png" } },
      model: { provider: "deepseek", modelId: "deepseek-v4-pro" },
    },
    fingerprint: { top: "fp-top", components: {} },
    versionStamp: { modelId: "deepseek-v4-pro" },
    createdAt: 1_700_000_000_000,
  } as unknown as Manifest;
}

const VP = { width: 1280, height: 720 };
const PNG = Buffer.from("fake-png-bytes");

function insMetric(db: Database.Database, runId: string, name: string, value: number, unit: string) {
  db.prepare("INSERT INTO metrics (run_id, name, value, unit) VALUES (?,?,?,?)").run(
    runId,
    name,
    value,
    unit,
  );
}
function insTool(db: Database.Database, runId: string, name: string, calls: number, errors: number) {
  db.prepare(
    "INSERT INTO tool_calls (run_id, tool_name, call_count, error_count) VALUES (?,?,?,?)",
  ).run(runId, name, calls, errors);
}

describe("renderReport", () => {
  it("SELF-CONTAINMENT: three base64 image panels, one inline style block, zero external refs", () => {
    const { db, resultsRoot } = setup();
    const runId = "run-scored";
    persistManifest(db, makeManifest(runId));
    updateRunComposite(db, runId, 0.83, { pixelmatch: 0.4, dom: 0.2, axe: 0.2, judge: 0.2 });
    updateRunOutcome(db, runId, "completed", null, 1_700_000_042_100);
    insertEvaluation(db, runId, 0, "pixelmatch", 0.9, {});
    insertEvaluation(db, runId, 0, "dom", 0.8, {});
    insertEvaluation(db, runId, 0, "axe", 0.7, {});
    insertEvaluation(db, runId, 0, "judge", 0.85, {});
    linkExpectedScreenshot(db, runId, PNG, VP, resultsRoot);
    linkDiffScreenshot(db, runId, PNG, VP, resultsRoot);
    writeArtifact(db, runId, "screenshot", "generated.png", PNG, resultsRoot);
    insMetric(db, runId, "wall_ms", 42100, "ms");
    insMetric(db, runId, "build_ms", 5000, "ms");
    insMetric(db, runId, "cost_usd", 0.037, "usd");
    insMetric(db, runId, "total_tokens", 18400, "tokens");
    insMetric(db, runId, "iteration_count", 6, "count");
    insTool(db, runId, "read", 10, 0);
    insTool(db, runId, "bash", 3, 1);

    const html = renderReport(db, runId, resultsRoot);
    db.close();

    // three base64 image panels
    expect(html.match(/data:image\/png;base64,/g)?.length).toBe(3);
    // exactly one inline style block, no external CSS/JS/network
    expect(html.match(/<style/g)?.length).toBe(1);
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<script"); // native details/summary — no JS at all
    expect(html).not.toContain("fetch(");
    expect(html).not.toMatch(/src=["']https?:\/\//); // no external image source
    expect(html).not.toMatch(/src=["']\.?\//); // no relative file source
    // header names come from the manifest
    expect(html).toContain("angular");
    expect(html).toContain("deepseek-v4-pro");
    expect(html).toContain("landing");
  });

  it("ESCAPING: narration / run_id / tool args are HTML-escaped, never live markup", () => {
    const { db, resultsRoot } = setup();
    const runId = `run&<>"'x`;
    persistManifest(db, makeManifest(runId));
    updateRunOutcome(db, runId, "completed", null, 1_700_000_010_000);
    appendEvent(db, {
      type: "unknown",
      runId,
      ts: 1_700_000_001_000,
      piType: "message_update",
      raw: { text: `<script>alert(1)</script><img src=x onerror=alert(2)>` },
    });
    appendEvent(db, {
      type: "tool_call",
      runId,
      ts: 1_700_000_002_000,
      toolName: "bash",
      argsSummary: `rm -rf <"'>`,
      isError: false,
    });
    insMetric(db, runId, "iteration_count", 1, "count");

    const html = renderReport(db, runId, resultsRoot);
    db.close();

    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<script>alert");
    // no LIVE img element carrying an onerror handler (escaped inert text is fine)
    expect(html).not.toMatch(/<img\b[^>]*onerror/i);
    // run_id angle brackets escaped
    expect(html).toContain("run&amp;");
  });

  it("PARTIAL/FAILED (D5-05): build_failed renders empty-state + em-dash composite, never an error screen", () => {
    const { db, resultsRoot } = setup();
    const runId = "run-failed";
    persistManifest(db, makeManifest(runId));
    // composite stays NULL; no generated/expected/diff screenshots
    updateRunOutcome(db, runId, "build_failed", "build", 1_700_000_005_000);
    insMetric(db, runId, "build_ms", 4200, "ms");
    insMetric(db, runId, "iteration_count", 2, "count");

    const html = renderReport(db, runId, resultsRoot);
    db.close();

    expect(html).toContain("No screenshot captured");
    expect(html).toContain("build"); // failed stage named in empty-state body + pill
    expect(html).toContain("stopped at");
    // status pill for a failed run
    expect(html).toContain("FAILED · build");
    // null composite → em-dash + note (D5-05)
    expect(html).toContain("—");
    expect(html).toContain("No composite — run did not reach evaluation.");
    // a scored data point, not a crash/error screen
    expect(html).not.toContain("Something went wrong");
    expect(html.length).toBeGreaterThan(0);
  });

  it("SECTION ORDER (D5-04): header < scorecard < screenshots < metrics < timeline", () => {
    const { db, resultsRoot } = setup();
    const runId = "run-order";
    persistManifest(db, makeManifest(runId));
    updateRunComposite(db, runId, 0.5, { pixelmatch: 1 });
    updateRunOutcome(db, runId, "completed", null, 1_700_000_009_000);
    insertEvaluation(db, runId, 0, "pixelmatch", 0.5, {});
    writeArtifact(db, runId, "screenshot", "generated.png", PNG, resultsRoot);
    insMetric(db, runId, "iteration_count", 1, "count");

    const html = renderReport(db, runId, resultsRoot);
    db.close();

    const header = html.indexOf('id="report-header"');
    const scorecard = html.indexOf('id="report-scorecard"');
    const screenshots = html.indexOf('id="report-screenshots"');
    const metrics = html.indexOf('id="report-metrics"');
    const timeline = html.indexOf('id="report-timeline"');
    expect(header).toBeGreaterThanOrEqual(0);
    expect(header).toBeLessThan(scorecard);
    expect(scorecard).toBeLessThan(screenshots);
    expect(screenshots).toBeLessThan(metrics);
    expect(metrics).toBeLessThan(timeline);
  });

  it("CAVEAT (D5-01): banner iff a mockup_grounding_skipped unknown event is present", () => {
    const { db, resultsRoot } = setup();
    const caveatCopy = "Visual-fidelity caveat: the agent had no mockup grounding for this run";

    // present → banner
    const withRun = "run-caveat-on";
    persistManifest(db, makeManifest(withRun));
    updateRunOutcome(db, withRun, "completed", null, 1_700_000_006_000);
    appendEvent(db, {
      type: "unknown",
      runId: withRun,
      ts: 1_700_000_001_000,
      piType: "mockup_grounding_skipped",
      raw: { reason: "model has no image input" },
    });
    insMetric(db, withRun, "iteration_count", 1, "count");
    const withHtml = renderReport(db, withRun, resultsRoot);
    expect(withHtml).toContain(caveatCopy);

    // absent → no banner
    const withoutRun = "run-caveat-off";
    persistManifest(db, makeManifest(withoutRun));
    updateRunOutcome(db, withoutRun, "completed", null, 1_700_000_007_000);
    insMetric(db, withoutRun, "iteration_count", 1, "count");
    const withoutHtml = renderReport(db, withoutRun, resultsRoot);
    expect(withoutHtml).not.toContain(caveatCopy);
    db.close();
  });

  it("BACKOFF (D5-12): attribution note iff backoff_wait_ms > 0", () => {
    const { db, resultsRoot } = setup();
    const noteFragment = "waiting on provider rate-limit/backoff";

    const onRun = "run-backoff-on";
    persistManifest(db, makeManifest(onRun));
    updateRunOutcome(db, onRun, "completed", null, 1_700_000_006_000);
    insMetric(db, onRun, "wall_ms", 42100, "ms");
    insMetric(db, onRun, "backoff_wait_ms", 1500, "ms");
    insMetric(db, onRun, "iteration_count", 1, "count");
    const onHtml = renderReport(db, onRun, resultsRoot);
    expect(onHtml).toContain(noteFragment);
    expect(onHtml).toContain("Includes 1500 ms");

    const offRun = "run-backoff-off";
    persistManifest(db, makeManifest(offRun));
    updateRunOutcome(db, offRun, "completed", null, 1_700_000_007_000);
    insMetric(db, offRun, "wall_ms", 42100, "ms");
    insMetric(db, offRun, "iteration_count", 1, "count");
    const offHtml = renderReport(db, offRun, resultsRoot);
    expect(offHtml).not.toContain(noteFragment);
    db.close();
  });
});
