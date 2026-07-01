import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDb } from "../src/storage/db.js";
import { getArtifactPath, writeArtifact } from "../src/storage/artifacts.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  dir = mkdtempSync(join(tmpdir(), "web-stack-evals-artifacts-test-"));
  const db = openDb(join(dir, "results.sqlite"));
  const resultsRoot = join(dir, "results");
  return { db, resultsRoot };
}

describe("writeArtifact / getArtifactPath", () => {
  it("writes bytes under results/<runId>/ and links a relative path (not the bytes) in the DB", () => {
    const { db, resultsRoot } = setup();
    const bytes = Buffer.from("fake-png-bytes");

    const id = writeArtifact(db, "run-1", "screenshot", "x.png", bytes, resultsRoot);

    const row = db.prepare("SELECT path, sha FROM artifacts WHERE id = ?").get(id) as {
      path: string;
      sha: string;
    };
    expect(row.path).toBe(join("run-1", "x.png"));
    expect(row.sha).toMatch(/^[a-f0-9]{64}$/);
    db.close();
  });

  it("round-trips: write -> DB link -> read yields identical bytes (SC#5)", () => {
    const { db, resultsRoot } = setup();
    const bytes = Buffer.from("round-trip-bytes");

    const id = writeArtifact(db, "run-1", "screenshot", "x.png", bytes, resultsRoot);
    const relativePath = getArtifactPath(db, id);
    expect(relativePath).not.toBeNull();

    const onDisk = readFileSync(resolve(resultsRoot, relativePath!));
    expect(onDisk).toEqual(bytes);
    db.close();
  });

  it("getArtifactPath returns null for an unknown id", () => {
    const { db } = setup();
    expect(getArtifactPath(db, 999999)).toBeNull();
    db.close();
  });

  it("rejects a traversing filename before writing anything to disk or the DB", () => {
    const { db, resultsRoot } = setup();
    const bytes = Buffer.from("evil");

    expect(() =>
      writeArtifact(db, "run-1", "screenshot", "../../evil.png", bytes, resultsRoot),
    ).toThrow();

    // Containment is checked before any mkdir/write — the results root
    // itself must never have been created.
    expect(existsSync(resultsRoot)).toBe(false);

    const count = db.prepare("SELECT COUNT(*) as c FROM artifacts").get() as { c: number };
    expect(count.c).toBe(0);
    db.close();
  });
});
