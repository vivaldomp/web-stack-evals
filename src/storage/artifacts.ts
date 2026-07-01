import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import type Database from "better-sqlite3";

/** Default artifact root (D-22): results/<run_id>/… next to the process cwd. */
const DEFAULT_RESULTS_ROOT = "results";

const insertArtifactSql = `
  INSERT INTO artifacts (run_id, kind, path, sha, created_at)
  VALUES (@run_id, @kind, @path, @sha, @created_at)
`;

const selectArtifactPathSql = `SELECT path FROM artifacts WHERE id = @id`;

/**
 * Writes artifact bytes to results/<runId>/<filename> (D-15) and links a
 * relative path + sha256 into the artifacts table (never the bytes
 * themselves). Enforces V12 path-containment (T-1-V12-01): the resolved
 * target must stay inside the resolved run dir, or this throws before any
 * mkdir/write/DB insert happens. `resultsRoot` defaults to `results` under
 * cwd and is overridable so tests can point it at a tmp dir.
 */
export function writeArtifact(
  db: Database.Database,
  runId: string,
  kind: string,
  filename: string,
  bytes: Buffer,
  resultsRoot: string = DEFAULT_RESULTS_ROOT,
): number {
  const resultsRootResolved = resolve(resultsRoot);
  const runDir = resolve(resultsRootResolved, runId);
  const targetPath = resolve(runDir, filename);

  if (targetPath !== runDir && !targetPath.startsWith(runDir + sep)) {
    throw new Error(`Artifact filename escapes results/${runId}/: ${filename}`);
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, bytes);

  const sha = createHash("sha256").update(bytes).digest("hex");
  const relativePath = relative(resultsRootResolved, targetPath);

  const info = db.prepare(insertArtifactSql).run({
    run_id: runId,
    kind,
    path: relativePath,
    sha,
    created_at: Date.now(),
  });
  return Number(info.lastInsertRowid);
}

/**
 * Reads back the stored relative path for an artifact row via a prepared
 * SELECT (D-15); resolving it against the results root yields the bytes
 * written by writeArtifact. Returns null for an unknown id.
 */
export function getArtifactPath(db: Database.Database, id: number): string | null {
  const row = db.prepare(selectArtifactPathSql).get({ id }) as { path: string } | undefined;
  return row ? row.path : null;
}
