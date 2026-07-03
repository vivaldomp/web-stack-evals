import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { readEvents } from "../storage/db.js";
import { getArtifactPath } from "../storage/artifacts.js";

// Self-contained static HTML post-mortem report (REPORT-02 / CLI-02 / D5-04/05/09).
// Pure function: reads ONLY the results DB rows + on-disk artifact PNGs, returns one
// portable HTML string (template literals, no runtime framework, no CDN). Every image
// is a data: URI, all CSS is one inline <style>, the timeline collapse is native
// <details>/<summary> (no JS) — the D5-09 self-containment invariant.

/** PRIMARY XSS mitigation (T-05-01): the single choke point every untrusted value
 * passes through before entering the template. Order matters — ampersand first. */
function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const EM_DASH = "—";
const MIDDOT = "·";

interface RunRow {
  status: string | null;
  failed_stage: string | null;
  manifest: string | null;
  composite_score: number | null;
  rep_index: number;
  started_at: number | null;
  finished_at: number | null;
}

const SUB_SCORES: { key: string; label: string }[] = [
  { key: "pixelmatch", label: "pixelmatch" },
  { key: "dom", label: "dom" },
  { key: "axe", label: "a11y" },
  { key: "judge", label: "judge" },
];

const PERF_METRICS = [
  "wall_ms",
  "install_ms",
  "build_ms",
  "start_ms",
  "render_ms",
  "ttft_ms",
  "cost_usd",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "total_tokens",
];
const ENG_METRICS = ["files_created", "files_edited", "lines_added", "lines_removed"];
const ITER_METRICS = ["iteration_count", "correction_density"];

/** Resolve an artifact's bytes → data: URI, or null when absent/unreadable. */
function dataUri(db: Database.Database, id: number | undefined, resultsRoot: string): string | null {
  if (id === undefined) return null;
  const rel = getArtifactPath(db, id);
  if (!rel) return null;
  try {
    return `data:image/png;base64,${readFileSync(resolve(resultsRoot, rel)).toString("base64")}`;
  } catch {
    return null;
  }
}

function scenarioName(expectedPath: string | undefined): string {
  if (!expectedPath) return "scenario";
  const parts = expectedPath.split(/[\\/]/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1] ?? "scenario";
}

/**
 * Renders one stored benchmark run into a single self-contained HTML string.
 * `resultsRoot` defaults to artifacts.ts' `results` root and is overridable for tests.
 */
export function renderReport(
  db: Database.Database,
  runId: string,
  resultsRoot: string = "results",
): string {
  const run = db
    .prepare(
      "SELECT status, failed_stage, manifest, composite_score, rep_index, started_at, finished_at FROM runs WHERE run_id = @run_id",
    )
    .get({ run_id: runId }) as RunRow | undefined;

  // Manifest-derived header names. Specs carry no `name` field, so we display the
  // stable identifiers that DO exist: stack.template, versionStamp.modelId, and the
  // scenario's expected-screenshot directory.
  let stackName = "stack";
  let modelName = "model";
  let scName = "scenario";
  if (run?.manifest) {
    try {
      const m = JSON.parse(run.manifest);
      stackName = m?.specSnapshot?.stack?.template ?? stackName;
      modelName = m?.versionStamp?.modelId ?? m?.specSnapshot?.model?.modelId ?? modelName;
      scName = scenarioName(m?.specSnapshot?.scenario?.expected?.path);
    } catch {
      // keep defaults — a malformed manifest never crashes the report (D5-05)
    }
  }

  const status = run?.status ?? "unknown";
  const failedStage = run?.failed_stage ?? "";

  // --- status pill (semantic colors reserved strictly for status) ---
  let pillText: string;
  let pillColor: string;
  if (status === "completed") {
    pillText = "SCORED";
    pillColor = "#16a34a";
  } else if (status === "timeout") {
    pillText = `CAPPED ${MIDDOT} timeout`;
    pillColor = "#d97706";
  } else {
    pillText = `FAILED ${MIDDOT} ${esc(failedStage)}`;
    pillColor = "#dc2626";
  }

  const ts = run?.started_at ? new Date(run.started_at).toISOString() : EM_DASH;

  // --- evaluations → sub-score map ---
  const evalRows = db
    .prepare("SELECT evaluator_name, raw_score FROM evaluations WHERE run_id = @run_id")
    .all({ run_id: runId }) as { evaluator_name: string; raw_score: number | null }[];
  const subScores = new Map<string, number | null>();
  for (const r of evalRows) subScores.set(r.evaluator_name, r.raw_score);

  // --- metrics + tool_calls + iterations ---
  const metricRows = db
    .prepare("SELECT name, value, unit FROM metrics WHERE run_id = @run_id")
    .all({ run_id: runId }) as { name: string; value: number; unit: string }[];
  const metrics = new Map<string, { value: number; unit: string }>();
  for (const r of metricRows) metrics.set(r.name, { value: r.value, unit: r.unit });

  const toolRows = db
    .prepare(
      "SELECT tool_name, call_count, error_count FROM tool_calls WHERE run_id = @run_id ORDER BY tool_name",
    )
    .all({ run_id: runId }) as { tool_name: string; call_count: number; error_count: number }[];

  // --- the events log: fed to the timeline AND the caveat probe (one read) ---
  const events = readEvents(db, runId);
  const mockupSkipped = events.some(
    (e) => e.type === "unknown" && e.piType === "mockup_grounding_skipped",
  );

  // --- screenshots ---
  const expShot = db
    .prepare(
      "SELECT s.artifact_id AS id FROM screenshots s JOIN artifacts a ON a.id = s.artifact_id WHERE a.run_id = @run_id AND s.role = 'expected' ORDER BY s.id DESC LIMIT 1",
    )
    .get({ run_id: runId }) as { id: number } | undefined;
  const diffShot = db
    .prepare(
      "SELECT s.artifact_id AS id FROM screenshots s JOIN artifacts a ON a.id = s.artifact_id WHERE a.run_id = @run_id AND s.role = 'diff' ORDER BY s.id DESC LIMIT 1",
    )
    .get({ run_id: runId }) as { id: number } | undefined;
  const genShot = db
    .prepare(
      "SELECT id FROM artifacts WHERE run_id = @run_id AND kind = 'screenshot' AND path LIKE '%generated.png' ORDER BY id DESC LIMIT 1",
    )
    .get({ run_id: runId }) as { id: number } | undefined;

  const expectedUri = dataUri(db, expShot?.id, resultsRoot);
  const diffUri = dataUri(db, diffShot?.id, resultsRoot);
  const generatedUri = dataUri(db, genShot?.id, resultsRoot);

  // ---- section builders ----
  const emptyStateBody = `The run stopped at the <strong>${esc(
    failedStage || "unknown",
  )}</strong> stage before the app rendered. The metrics below reflect everything the run did produce.`;

  const panel = (caption: string, uri: string | null): string => {
    const body = uri
      ? `<img alt="${esc(caption)}" src="${uri}" />`
      : `<div class="empty"><div class="empty-h">No screenshot captured</div><div class="empty-b">${emptyStateBody}</div></div>`;
    return `<figure class="shot"><figcaption>${esc(caption)}</figcaption>${body}</figure>`;
  };

  // scorecard
  const compositeCell =
    run?.composite_score == null
      ? `<div class="composite">${EM_DASH}</div><div class="note">No composite ${EM_DASH} run did not reach evaluation.</div>`
      : `<div class="composite">${run.composite_score.toFixed(2)}</div>`;

  const bars = SUB_SCORES.map(({ key, label }) => {
    const v = subScores.has(key) ? subScores.get(key) : undefined;
    if (v == null) {
      return `<div class="bar-row"><span class="bar-label">${esc(label)}</span><span class="bar-val">${EM_DASH}</span></div>`;
    }
    const pct = Math.max(0, Math.min(100, Math.round(v * 100)));
    return `<div class="bar-row"><span class="bar-label">${esc(label)}</span><span class="track"><span class="fill" style="width:${pct}%"></span></span><span class="bar-val">${v.toFixed(2)}</span></div>`;
  }).join("");

  // metrics groups
  const metricRow = (name: string): string => {
    const m = metrics.get(name);
    if (!m) return "";
    let extra = "";
    if (name === "wall_ms") {
      const b = metrics.get("backoff_wait_ms");
      if (b && b.value > 0) {
        extra = `<tr><td colspan="2" class="metric-note">Includes ${esc(
          b.value,
        )} ms waiting on provider rate-limit/backoff ${EM_DASH} surfaced separately, not counted as agent productive time.</td></tr>`;
      }
    }
    return `<tr><td class="mname">${esc(name)}</td><td class="mval">${esc(m.value)}${
      m.unit ? ` <span class="unit">${esc(m.unit)}</span>` : ""
    }</td></tr>${extra}`;
  };

  const group = (title: string, names: string[]): string => {
    const rows = names.map(metricRow).join("");
    if (!rows) return "";
    return `<div class="mgroup"><div class="eyebrow">${esc(title)}</div><table>${rows}</table></div>`;
  };

  const toolGroup = ((): string => {
    if (toolRows.length === 0) return "";
    const rows = toolRows
      .map(
        (t) =>
          `<tr><td class="mname">${esc(t.tool_name)}</td><td class="mval">${esc(
            t.call_count,
          )}</td><td class="mval ${t.error_count > 0 ? "err" : ""}">${esc(t.error_count)}</td></tr>`,
      )
      .join("");
    return `<div class="mgroup"><div class="eyebrow">Tool calls by type</div><table><tr><th></th><th>calls</th><th>errors</th></tr>${rows}</table></div>`;
  })();

  // timeline (seq-ordered narration + tool calls)
  const timelineLines = events
    .map((e) => {
      if (e.type === "unknown" && e.piType === "message_update") {
        const raw = e.raw as unknown;
        let text: string;
        if (typeof raw === "string") text = raw;
        else {
          const r = raw as Record<string, unknown> | null;
          text =
            (typeof r?.text === "string" && r.text) ||
            (typeof r?.delta === "string" && r.delta) ||
            JSON.stringify(raw);
        }
        return `<div class="tl-line tl-say">${esc(text)}</div>`;
      }
      if (e.type === "tool_call") {
        const mark = e.isError ? ` <span class="err">[error]</span>` : "";
        return `<div class="tl-line tl-tool">${esc(e.toolName)} ${esc(e.argsSummary)}${mark}</div>`;
      }
      return "";
    })
    .filter(Boolean)
    .join("");

  const caveat = mockupSkipped
    ? `<div id="report-caveat" class="caveat">Visual-fidelity caveat: the agent had no mockup grounding for this run ${EM_DASH} the resolved model does not accept image input, so the expected screenshot was not shown to it. Scoring is unaffected (the judge diffs screenshots on its own vision model).</div>`
    : "";

  const style = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f8fafc; color: #0f172a;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 14px; line-height: 1.5; }
    .page { max-width: 960px; margin: 64px auto; padding: 0 24px; }
    .mono { font-family: ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace; }
    section { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;
      padding: 16px; margin-bottom: 48px; }
    h2 { font-size: 20px; font-weight: 600; line-height: 1.25; margin: 0 0 16px;
      border-bottom: 2px solid #2563eb; padding-bottom: 4px; display: inline-block; }
    .eyebrow { font-size: 12px; font-weight: 600; line-height: 1.4;
      letter-spacing: 0.05em; text-transform: uppercase; color: #64748b; margin: 16px 0 8px; }
    .muted { color: #64748b; }
    #report-header .title { font-size: 20px; font-weight: 600; }
    .pill { display: inline-block; font-size: 12px; font-weight: 600; line-height: 1.4;
      padding: 4px 8px; border-radius: 999px; color: #fff; }
    .caveat { background: #fff; border-left: 4px solid #d97706;
      padding: 8px 16px; margin-bottom: 48px; }
    .composite { font-size: 32px; font-weight: 600; line-height: 1.2; color: #2563eb; }
    .note { font-size: 12px; font-weight: 600; color: #64748b; }
    .bar-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
    .bar-label { font-size: 12px; font-weight: 600; width: 96px; }
    .track { flex: 1; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
    .fill { display: block; height: 100%; background: #2563eb; }
    .bar-val { font-family: ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace; width: 48px; text-align: right; }
    .triptych { display: flex; gap: 32px; flex-wrap: wrap; }
    .shot { flex: 1; min-width: 200px; margin: 0; }
    .shot img { width: 100%; border: 1px solid #e2e8f0; border-radius: 4px; }
    .shot figcaption { font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 4px; }
    .empty { border: 1px dashed #e2e8f0; border-radius: 4px; padding: 16px; }
    .empty-h { font-weight: 600; }
    .empty-b { color: #64748b; }
    .mgroup { margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; }
    td, th { padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: left; }
    th { font-size: 12px; font-weight: 600; color: #64748b; }
    .mname { font-weight: 600; }
    .mval { font-family: ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace; }
    .unit { color: #64748b; }
    .err { color: #dc2626; }
    .metric-note { font-size: 12px; color: #64748b; }
    details { margin-top: 8px; }
    summary { cursor: pointer; font-weight: 600; }
    summary .hide { display: none; }
    details[open] summary .show { display: none; }
    details[open] summary .hide { display: inline; }
    .tl-line { font-family: ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace;
      padding: 4px 0; border-bottom: 1px solid #e2e8f0; white-space: pre-wrap; }
    .tl-tool { color: #64748b; }
  `;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Benchmark report ${esc(runId)}</title>
<style>${style}</style></head>
<body><div class="page">
  <section id="report-header">
    <div class="title">${esc(stackName)} ${MIDDOT} ${esc(modelName)} ${MIDDOT} ${esc(scName)}</div>
    <div class="mono muted">${esc(runId)}</div>
    <div class="muted">${esc(ts)} ${MIDDOT} rep ${esc(run?.rep_index ?? 0)}</div>
    <div><span class="pill" style="background:${pillColor}">${pillText}</span></div>
  </section>
  ${caveat}
  <section id="report-scorecard">
    <h2>Scorecard</h2>
    ${compositeCell}
    <div class="bars">${bars}</div>
  </section>
  <section id="report-screenshots">
    <h2>Screenshots</h2>
    <div class="triptych">
      ${panel("Expected", expectedUri)}
      ${panel("Generated", generatedUri)}
      ${panel("Diff", diffUri)}
    </div>
  </section>
  <section id="report-metrics">
    <h2>Metrics</h2>
    ${group("Performance", PERF_METRICS)}
    ${group("Engineering", ENG_METRICS)}
    ${group("Iteration", ITER_METRICS)}
    ${toolGroup}
  </section>
  <section id="report-timeline">
    <h2>Agent Timeline</h2>
    <details>
      <summary><span class="show">Show agent timeline</span><span class="hide">Hide agent timeline</span></summary>
      <div class="timeline">${timelineLines}</div>
    </details>
  </section>
</div></body></html>`;
}
