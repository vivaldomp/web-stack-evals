import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/storage/db.js";
import { updateRunOutcome, linkExpectedScreenshot } from "../src/storage/evaluations.js";
import { getArtifactPath } from "../src/storage/artifacts.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  dir = mkdtempSync(join(tmpdir(), "web-stack-evals-runoutcome-test-"));
  const db = openDb(join(dir, "results.sqlite"));
  const resultsRoot = join(dir, "results");
  db.prepare("INSERT INTO runs (run_id, status) VALUES (?, ?)").run("run-1", "pending");
  return { db, resultsRoot };
}

describe("updateRunOutcome", () => {
  it("flips a pending row to a failed terminal with failed_stage + finished_at set", () => {
    const { db } = setup();

    updateRunOutcome(db, "run-1", "build_failed", "build", 1234);

    const row = db.prepare("SELECT * FROM runs WHERE run_id = ?").get("run-1") as {
      status: string;
      failed_stage: string | null;
      finished_at: number | null;
    };

    expect(row.status).toBe("build_failed");
    expect(row.failed_stage).toBe("build");
    expect(row.finished_at).toBe(1234);
    db.close();
  });

  it("writes a completed terminal with failed_stage NULL and finished_at set", () => {
    const { db } = setup();

    updateRunOutcome(db, "run-1", "completed", null, 9000);

    const row = db.prepare("SELECT * FROM runs WHERE run_id = ?").get("run-1") as {
      status: string;
      failed_stage: string | null;
      finished_at: number | null;
    };

    expect(row.status).toBe("completed");
    expect(row.failed_stage).toBeNull();
    expect(row.finished_at).toBe(9000);
    db.close();
  });
});

describe("linkExpectedScreenshot", () => {
  it("persists a role='expected' screenshots row whose artifact bytes read back byte-identical", () => {
    const { db, resultsRoot } = setup();
    const pngBuffer = Buffer.from("fake-expected-png-bytes");

    const artifactId = linkExpectedScreenshot(
      db,
      "run-1",
      pngBuffer,
      { width: 1280, height: 800 },
      resultsRoot,
    );

    expect(typeof artifactId).toBe("number");

    const row = db
      .prepare("SELECT role, viewport FROM screenshots WHERE artifact_id = ?")
      .get(artifactId) as { role: string; viewport: string };

    expect(row.role).toBe("expected");
    expect(JSON.parse(row.viewport)).toEqual({ width: 1280, height: 800 });

    const relPath = getArtifactPath(db, artifactId);
    expect(relPath).not.toBeNull();
    const bytes = readFileSync(join(resultsRoot, relPath!));
    expect(bytes.equals(pngBuffer)).toBe(true);
    db.close();
  });
});
