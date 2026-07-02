import type Database from "better-sqlite3";
import { writeArtifact } from "./artifacts.js";

const insertEvaluationSql = `
  INSERT INTO evaluations (run_id, rep_index, evaluator_name, raw_score, detail)
  VALUES (@run_id, @rep_index, @evaluator_name, @raw_score, @detail)
`;

const updateRunCompositeSql = `
  UPDATE runs SET composite_score = @composite_score, composite_weights = @composite_weights
  WHERE run_id = @run_id
`;

const insertScreenshotSql = `
  INSERT INTO screenshots (artifact_id, role, viewport, dpr)
  VALUES (@artifact_id, 'diff', @viewport, 1)
`;

const selectCachedJudgeVerdictSql = `
  SELECT raw_score, detail FROM evaluations
  WHERE evaluator_name = 'judge' AND raw_score IS NOT NULL
    AND json_extract(detail, '$.fingerprint') = @fingerprint
  ORDER BY id DESC LIMIT 1
`;

/**
 * Persists one raw evaluator score for a run/rep as its own evaluations row
 * (D-20 — one row per run/rep/evaluator, new evaluator = new rows, no schema
 * change). `rawScore` is nullable: a dropped/failed evaluator is recorded
 * with `raw_score = NULL` and its reason in `detail`, never silently
 * collapsed to 0 (D3-04).
 */
export function insertEvaluation(
  db: Database.Database,
  runId: string,
  repIndex: number,
  evaluatorName: string,
  rawScore: number | null,
  detail: unknown,
): void {
  db.prepare(insertEvaluationSql).run({
    run_id: runId,
    rep_index: repIndex,
    evaluator_name: evaluatorName,
    raw_score: rawScore,
    detail: JSON.stringify(detail),
  });
}

/**
 * Writes the composite score + the weights actually used onto an existing
 * runs row (D-21), independent of and after the raw evaluations rows.
 */
export function updateRunComposite(
  db: Database.Database,
  runId: string,
  compositeScore: number,
  weightsUsed: Record<string, number>,
): void {
  db.prepare(updateRunCompositeSql).run({
    run_id: runId,
    composite_score: compositeScore,
    composite_weights: JSON.stringify(weightsUsed),
  });
}

/**
 * Writes a diff screenshot's bytes via the shared writeArtifact convention
 * (D-15, reused not reimplemented) and links a screenshots row with
 * role='diff' (D-25/D3-07). Returns the artifact id.
 */
export function linkDiffScreenshot(
  db: Database.Database,
  runId: string,
  diffPng: Buffer,
  viewport: { width: number; height: number },
  resultsRoot?: string,
): number {
  const artifactId =
    resultsRoot === undefined
      ? writeArtifact(db, runId, "screenshot", "diff.png", diffPng)
      : writeArtifact(db, runId, "screenshot", "diff.png", diffPng, resultsRoot);

  db.prepare(insertScreenshotSql).run({
    artifact_id: artifactId,
    viewport: JSON.stringify(viewport),
  });

  return artifactId;
}

/**
 * Looks up a prior judge verdict by fingerprint directly from the
 * evaluations rows (D3-14 — no separate cache table). Returns the most
 * recent matching non-null-score row, or null when no prior verdict exists.
 */
export function lookupCachedJudgeVerdict(
  db: Database.Database,
  fingerprint: string,
): { rawScore: number; detail: unknown } | null {
  const row = db.prepare(selectCachedJudgeVerdictSql).get({ fingerprint }) as
    | { raw_score: number; detail: string }
    | undefined;

  if (!row) return null;
  return { rawScore: row.raw_score, detail: JSON.parse(row.detail) };
}
