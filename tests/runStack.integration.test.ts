import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import type Database from "better-sqlite3";
import { runStack, type RunOutcome } from "../src/pipeline/runStack.js";
import { copyWorkspace } from "../src/workspace/copy.js";
import { loadStack } from "../src/specs/load.js";
import { openDb } from "../src/storage/db.js";
import { createStoragePort } from "../src/storage/storagePort.js";
import { newRunId } from "../src/core/ids.js";
import type { StoragePort } from "../src/core/ports.js";
import type { Stack } from "../src/specs/types.js";

// The real production spec (Plan 02-02) — never a fixture stand-in for this suite.
const stack = loadStack("stacks/angular.yaml");

/** Same tmp-DB-file convention as tests/artifacts.test.ts's setup() helper. */
function setup(): { dir: string; db: Database.Database; resultsRoot: string; storage: StoragePort } {
  const dir = mkdtempSync(join(tmpdir(), "web-stack-evals-runstack-integration-"));
  const db = openDb(join(dir, "results.sqlite"));
  const resultsRoot = join(dir, "results");
  return { dir, db, resultsRoot, storage: createStoragePort(db, resultsRoot) };
}

function readMeta(db: Database.Database, resultsRoot: string, runId: string): { distBytes: number } {
  const row = db.prepare("SELECT path FROM artifacts WHERE run_id = ? AND kind = 'meta'").get(runId) as
    | { path: string }
    | undefined;
  if (!row) throw new Error(`no meta artifact found for run ${runId}`);
  return JSON.parse(readFileSync(resolve(resultsRoot, row.path), "utf8"));
}

describe("runStack — real Angular template, happy path (slow, unstubbed pipeline)", () => {
  let dir: string;
  let db: Database.Database;
  let resultsRoot: string;
  let storage: StoragePort;
  let runId: string;
  let outcome: RunOutcome;

  beforeAll(async () => {
    ({ dir, db, resultsRoot, storage } = setup());
    runId = newRunId();
    outcome = await runStack(stack, runId, storage);
  });

  afterAll(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    // Defensive (D2-05 already deletes tmp/<runId> on success) — in case an
    // assertion above failed mid-suite and left it behind.
    rmSync(resolve("tmp", runId), { recursive: true, force: true });
  });

  it("creates workspace and completes the happy path", () => {
    expect(outcome.status).toBe("completed");
    expect(outcome.failedStage).toBeNull();
    expect(typeof outcome.screenshotArtifactId).toBe("string");
    expect(existsSync(resolve("tmp", runId))).toBe(false);
  });

  it("screenshot dimensions equal the declared viewport at dpr=1", () => {
    const relativePath = storage.getArtifactPath(outcome.screenshotArtifactId!);
    expect(relativePath).not.toBeNull();
    const bytes = readFileSync(resolve(resultsRoot, relativePath!));
    const png = PNG.sync.read(bytes);
    expect(png.width).toBe(stack.viewport.width);
    expect(png.height).toBe(stack.viewport.height);
  });

  it("non-fatal stages: lint/test do not block the screenshot", () => {
    const events = storage.readEvents(runId);
    const hasStage = (stage: "lint" | "test") =>
      events.some(
        (e) => (e.type === "stage_started" || e.type === "stage_completed" || e.type === "stage_failed") && e.stage === stage,
      );
    expect(hasStage("lint")).toBe(true);
    expect(hasStage("test")).toBe(true);
    // The assertion is about status not being gated by lint/test outcome, not
    // about forcing a specific lint/test exit code.
    expect(outcome.status).toBe("completed");
  });

  it("dist size is captured in meta.json", () => {
    const meta = readMeta(db, resultsRoot, runId);
    expect(typeof meta.distBytes).toBe("number");
    expect(meta.distBytes).toBeGreaterThan(0);
  });
});

describe("runStack — prePopulated skip-copy + live-page eval window (slow, unstubbed pipeline)", () => {
  let dir: string;
  let db: Database.Database;
  let resultsRoot: string;
  let storage: StoragePort;
  let runId: string;
  let outcome: RunOutcome;

  // Captured inside onLivePage while the server is still up — the only window
  // where tmp/<runId> exists on a *completed* run (cleanupWorkspace deletes it
  // immediately after). Records: sentinel survival (skip-copy proof), a live
  // page, a non-empty png, and a successful fetch against the running server.
  const live = {
    calls: 0,
    sentinelPresent: false,
    pngBytes: 0,
    pageTitleResolved: false,
    serverUpFetchOk: false,
  };

  beforeAll(async () => {
    ({ dir, db, resultsRoot, storage } = setup());
    runId = newRunId();

    // Stand in for the orchestrator (D5-13): pre-copy the template into the
    // exact dir runStack's prePopulated path resolves to, then drop an
    // agent-only marker NOT present in the pristine template.
    const appDir = copyWorkspace(stack.template, runId, "tmp");
    writeFileSync(join(appDir, "AGENT_SENTINEL.txt"), "agent-was-here");

    outcome = await runStack(stack, runId, storage, {
      prePopulated: true,
      onLivePage: async (page, generatedPng) => {
        live.calls += 1;
        // The sentinel is present in the very dir being served — proving
        // runStack built the agent-populated workspace, not a fresh copy.
        live.sentinelPresent = existsSync(resolve("tmp", runId, "angular", "AGENT_SENTINEL.txt"));
        live.pngBytes = generatedPng.length;
        live.pageTitleResolved = typeof (await page.title()) === "string";
        // Probe with node:http + `agent: false` (a one-off, un-pooled connection
        // destroyed after the response) rather than fetch: undici keeps sirv's
        // keep-alive socket pooled, and a lingering socket stalls sirv's graceful
        // SIGTERM shutdown — leaving the port bound past teardown.
        live.serverUpFetchOk = await new Promise<boolean>((resolveProbe) => {
          const req = httpGet(`http://localhost:${stack.port}`, { agent: false }, (res) => {
            const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400;
            res.resume(); // drain so the socket can close
            res.on("end", () => resolveProbe(ok));
          });
          req.on("error", () => resolveProbe(false));
        });
      },
    });
  });

  afterAll(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(resolve("tmp", runId), { recursive: true, force: true });
  });

  it("skip-copy: builds the agent-populated dir; sentinel survives into the serve window (D5-13 gap #1)", () => {
    expect(outcome.status).toBe("completed");
    expect(live.sentinelPresent).toBe(true);
  });

  it("live page is available for eval with the server up, then teardown kills it (D5-13 gap #2)", async () => {
    expect(live.calls).toBe(1);
    expect(live.pngBytes).toBeGreaterThan(0);
    expect(live.pageTitleResolved).toBe(true);
    expect(live.serverUpFetchOk).toBe(true);
    // After runStack returns, the outer finally has killed the server: onLivePage
    // fired *inside* the server-up window and teardown happened *after* it.
    await expect(fetch(`http://localhost:${stack.port}`)).rejects.toBeTruthy();
  });

  it("emits start/render stage events with numeric durationMs (TEL-03)", () => {
    const events = storage.readEvents(runId);
    for (const stage of ["start", "render"] as const) {
      expect(events.some((e) => e.type === "stage_started" && e.stage === stage)).toBe(true);
      const completed = events.find((e) => e.type === "stage_completed" && e.stage === stage);
      expect(completed).toBeDefined();
      expect(typeof (completed as { durationMs: number }).durationMs).toBe("number");
    }
  });
});

describe("runStack — forced failure/timeout variants + teardown (fast, real pipeline)", () => {
  let dir: string;
  let db: Database.Database;
  let storage: StoragePort;
  const runDirsToClean: string[] = [];

  beforeAll(() => {
    ({ dir, db, storage } = setup());
  });

  afterAll(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    // D2-05 keeps tmp/<runId> on any non-"completed" outcome for post-mortem
    // — clean it up ourselves since runStack deliberately does not.
    for (const runId of runDirsToClean) rmSync(resolve("tmp", runId), { recursive: true, force: true });
    runDirsToClean.length = 0;
  });

  it("install failure yields build_failed + failedStage install", async () => {
    const runId = newRunId();
    runDirsToClean.push(runId);
    // `false` is on PATH inside the allowlisted env and exits 1 immediately
    // — no need to touch the committed template or wait out a real npm ci failure.
    const badStack: Stack = { ...stack, install: "false" };

    const outcome = await runStack(badStack, runId, storage);

    expect(outcome.status).toBe("build_failed");
    expect(outcome.failedStage).toBe("install");
    expect(existsSync(resolve("tmp", runId))).toBe(true);
  });

  it("build timeout yields timeout + failedStage build", async () => {
    const runId = newRunId();
    runDirsToClean.push(runId);
    const slowBuildStack: Stack = {
      ...stack,
      install: "true", // instant-exit substitute — this test proves the timeout branch only
      build: "node -e setTimeout(()=>{},5000)",
      buildTimeoutMs: 200,
    };

    const outcome = await runStack(slowBuildStack, runId, storage);

    expect(outcome.status).toBe("timeout");
    expect(outcome.failedStage).toBe("build");
    expect(existsSync(resolve("tmp", runId))).toBe(true);
  });

  it("start failure (process exits before ready) yields start_failed + failedStage start", async () => {
    const runId = newRunId();
    runDirsToClean.push(runId);
    const badStartStack: Stack = {
      ...stack,
      install: "true",
      build: "true",
      start: "false", // exits non-zero almost immediately, never binds the port
    };

    const outcome = await runStack(badStartStack, runId, storage);

    expect(outcome.status).toBe("start_failed");
    expect(outcome.failedStage).toBe("start");
    expect(existsSync(resolve("tmp", runId))).toBe(true);
  });

  it("start/ready timeout yields timeout + failedStage start, and teardown leaves the port free", async () => {
    const runId = newRunId();
    runDirsToClean.push(runId);
    const hangStartStack: Stack = {
      ...stack,
      install: "true",
      build: "true",
      start: "node -e setTimeout(()=>{},5000)", // binds nothing, sleeps past startTimeoutMs
      startTimeoutMs: 300,
    };

    const outcome = await runStack(hangStartStack, runId, storage);

    expect(outcome.status).toBe("timeout");
    expect(outcome.failedStage).toBe("start");
    expect(existsSync(resolve("tmp", runId))).toBe(true);

    // WORK-04's literal port-free proof: a fresh connection attempt must
    // reject/refuse, not an inference from the returned status alone.
    await expect(fetch(`http://localhost:${stack.port}`)).rejects.toBeTruthy();
  });
});
