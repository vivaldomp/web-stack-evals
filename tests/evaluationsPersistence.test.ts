import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/storage/db.js";
import {
  insertEvaluation,
  updateRunComposite,
  linkDiffScreenshot,
  lookupCachedJudgeVerdict,
} from "../src/storage/evaluations.js";
import type Database from "better-sqlite3";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  dir = mkdtempSync(join(tmpdir(), "web-stack-evals-evaluations-test-"));
  const db = openDb(join(dir, "results.sqlite"));
  const resultsRoot = join(dir, "results");
  return { db, resultsRoot };
}

describe("insertEvaluation", () => {
  it("persists a raw sub-score readable back with its detail JSON", () => {
    const { db } = setup();
    insertEvaluation(db, "run-1", 0, "pixelmatch", 0.87, { mismatchedPixels: 130 });

    const row = db
      .prepare("SELECT * FROM evaluations WHERE run_id = ? AND evaluator_name = 'pixelmatch'")
      .get("run-1") as { raw_score: number; detail: string };

    expect(row.raw_score).toBe(0.87);
    expect(JSON.parse(row.detail)).toEqual({ mismatchedPixels: 130 });
    db.close();
  });

  it("persists a dropped evaluator with a null raw_score, never silently 0 (D3-04)", () => {
    const { db } = setup();
    insertEvaluation(db, "run-1", 0, "judge", null, { dropped: true, reason: "timeout" });

    const row = db
      .prepare("SELECT * FROM evaluations WHERE run_id = ? AND evaluator_name = 'judge'")
      .get("run-1") as { raw_score: number | null; detail: string };

    expect(row.raw_score).toBeNull();
    expect(JSON.parse(row.detail).dropped).toBe(true);
    db.close();
  });
});

describe("updateRunComposite", () => {
  it("updates composite_score + composite_weights on a pre-seeded runs row, leaving other columns untouched", () => {
    const { db } = setup();
    db.prepare("INSERT INTO runs (run_id, status) VALUES (?, ?)").run("run-1", "pending");

    updateRunComposite(db, "run-1", 0.91, { pixelmatch: 0.5, axe: 0.5 });

    const row = db.prepare("SELECT * FROM runs WHERE run_id = ?").get("run-1") as {
      composite_score: number;
      composite_weights: string;
      status: string;
    };

    expect(row.composite_score).toBe(0.91);
    expect(JSON.parse(row.composite_weights)).toEqual({ pixelmatch: 0.5, axe: 0.5 });
    expect(row.status).toBe("pending");
    db.close();
  });
});

describe("linkDiffScreenshot", () => {
  it("writes the diff png via the artifacts convention and links a screenshots row with role=diff", () => {
    const { db, resultsRoot } = setup();
    const pngBuffer = Buffer.from("fake-png-bytes");

    const artifactId = linkDiffScreenshot(
      db,
      "run-1",
      pngBuffer,
      { width: 20, height: 20 },
      resultsRoot,
    );

    expect(typeof artifactId).toBe("number");

    const row = db
      .prepare("SELECT role, viewport FROM screenshots WHERE artifact_id = ?")
      .get(artifactId) as { role: string; viewport: string };

    expect(row.role).toBe("diff");
    expect(JSON.parse(row.viewport)).toEqual({ width: 20, height: 20 });
    db.close();
  });
});

describe("lookupCachedJudgeVerdict", () => {
  it("returns null when no prior evaluations row carries the fingerprint", () => {
    const { db } = setup();
    expect(lookupCachedJudgeVerdict(db, "fp-none")).toBeNull();
    db.close();
  });

  it("returns the most recent non-null-score row matching the fingerprint on a second call", () => {
    const { db } = setup();
    const fingerprint = "fp-abc";

    expect(lookupCachedJudgeVerdict(db, fingerprint)).toBeNull();

    insertEvaluation(db, "run-1", 0, "judge", 0.75, { fingerprint, note: "first" });
    insertEvaluation(db, "run-2", 0, "judge", 0.8, { fingerprint, note: "second" });

    const cached = lookupCachedJudgeVerdict(db, fingerprint);
    expect(cached).not.toBeNull();
    expect(cached!.rawScore).toBe(0.8);
    expect((cached!.detail as { note: string }).note).toBe("second");
    db.close();
  });
});
