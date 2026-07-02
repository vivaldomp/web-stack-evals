import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { runStack } from "../src/pipeline/runStack.js";
import { loadStack } from "../src/specs/load.js";
import { openDb } from "../src/storage/db.js";
import { createStoragePort } from "../src/storage/storagePort.js";
import { newRunId } from "../src/core/ids.js";

/**
 * D2-06: test-only hash walk, no `src/` export. Sorted directory entries for
 * stable cross-OS ordering; skips `node_modules`/`.git`/`tmp`/`results` at
 * any depth (this suite's own transient output plus the usual noise).
 */
function hashTree(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry === "node_modules" || entry === ".git" || entry === "tmp" || entry === "results") continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      hash.update(relative(root, full));
      hash.update(readFileSync(full));
    }
  };
  walk(root);
  return hash.digest("hex");
}

const root = resolve(process.cwd());
let dir: string;
let runId: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  if (runId) rmSync(resolve("tmp", runId), { recursive: true, force: true });
});

describe("isolation self-test (WORK-02)", () => {
  it("runStack never mutates the main project tree", async () => {
    const before = hashTree(root);

    dir = mkdtempSync(join(tmpdir(), "web-stack-evals-isolation-selftest-"));
    const db = openDb(join(dir, "results.sqlite"));
    const resultsRoot = join(dir, "results");
    const storage = createStoragePort(db, resultsRoot);
    const stack = loadStack("stacks/angular.yaml");
    runId = newRunId();

    const outcome = await runStack(stack, runId, storage);
    db.close();

    expect(outcome.status).toBe("completed");

    const after = hashTree(root);
    expect(after).toBe(before);
  });
});
