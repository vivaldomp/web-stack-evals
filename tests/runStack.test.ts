import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runStack } from "../src/pipeline/runStack.js";
import type { AgentEvent } from "../src/core/events.js";
import type { StoragePort } from "../src/core/ports.js";
import type { Stack } from "../src/specs/types.js";

let dirs: string[] = [];
let runIds: string[] = [];

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
  for (const id of runIds) rmSync(resolve("tmp", id), { recursive: true, force: true });
  runIds = [];
});

function mkTmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function trackRunId(prefix: string): string {
  const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  runIds.push(id);
  return id;
}

function writeScript(dir: string, name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

function makeTemplate(): string {
  const t = mkTmp("web-stack-evals-runstack-tpl-");
  writeFileSync(join(t, "package.json"), '{"name":"fixture"}');
  return t;
}

interface FakeArtifact {
  runId: string;
  kind: string;
  filename: string;
  bytes: Buffer;
}

function fakeStorage(): { port: StoragePort; events: AgentEvent[]; artifacts: FakeArtifact[] } {
  const events: AgentEvent[] = [];
  const artifacts: FakeArtifact[] = [];
  let nextId = 0;
  const port: StoragePort = {
    appendEvent: (e) => {
      events.push(e);
    },
    readEvents: (runId) => events.filter((e) => e.runId === runId),
    writeArtifact: (runId, kind, filename, bytes) => {
      artifacts.push({ runId, kind, filename, bytes });
      return String(++nextId);
    },
    getArtifactPath: () => null,
    persistManifest: () => {},
  };
  return { port, events, artifacts };
}

function baseStack(template: string, overrides: Partial<Stack> = {}): Stack {
  return {
    template,
    preamble: "test stack preamble",
    install: "node --version",
    build: "node --version",
    start: "node --version",
    port: 41300,
    viewport: { width: 320, height: 240 },
    ...overrides,
  };
}

describe("runStack — fatal install/build paths", () => {
  it("returns build_failed/install and never rejects when install exits non-zero", async () => {
    const scriptsDir = mkTmp("web-stack-evals-runstack-scripts-");
    const failScript = writeScript(scriptsDir, "fail.mjs", "process.exit(1);\n");
    const template = makeTemplate();
    const runId = trackRunId("t1a");
    const { port, events } = fakeStorage();

    const stack = baseStack(template, { install: `node ${failScript}` });
    const outcome = await runStack(stack, runId, port);

    expect(outcome).toEqual({
      runId,
      status: "build_failed",
      failedStage: "install",
      screenshotArtifactId: null,
    });

    const finished = events.find((e) => e.type === "benchmark_finished");
    expect(finished).toMatchObject({ status: "build_failed", failedStage: "install" });

    const startedIdx = events.findIndex((e) => e.type === "stage_started" && e.stage === "install");
    const failedIdx = events.findIndex((e) => e.type === "stage_failed" && e.stage === "install");
    expect(startedIdx).toBeGreaterThanOrEqual(0);
    expect(failedIdx).toBeGreaterThan(startedIdx);
    expect(events[failedIdx]).toMatchObject({
      stage: "install",
      exitCode: 1,
      durationMs: expect.any(Number),
    });

    expect(events.some((e) => e.type === "stage_started" && e.stage === "build")).toBe(false);
  });

  it("returns timeout/install when the install command exceeds its timeout", async () => {
    const scriptsDir = mkTmp("web-stack-evals-runstack-scripts-");
    const slowScript = writeScript(scriptsDir, "slow.mjs", "await new Promise((r) => setTimeout(r, 5000));\n");
    const template = makeTemplate();
    const runId = trackRunId("t1b");
    const { port, events } = fakeStorage();

    const stack = baseStack(template, { install: `node ${slowScript}`, installTimeoutMs: 200 });
    const outcome = await runStack(stack, runId, port);

    expect(outcome.status).toBe("timeout");
    expect(outcome.failedStage).toBe("install");
    expect(outcome.screenshotArtifactId).toBeNull();

    const finished = events.find((e) => e.type === "benchmark_finished");
    expect(finished).toMatchObject({ status: "timeout", failedStage: "install" });
  }, 10000);

  it("returns build_failed/build when install succeeds but build exits non-zero", async () => {
    const scriptsDir = mkTmp("web-stack-evals-runstack-scripts-");
    const okScript = writeScript(scriptsDir, "ok.mjs", "process.exit(0);\n");
    const failScript = writeScript(scriptsDir, "fail.mjs", "process.exit(1);\n");
    const template = makeTemplate();
    const runId = trackRunId("t1c");
    const { port, events } = fakeStorage();

    const stack = baseStack(template, { install: `node ${okScript}`, build: `node ${failScript}` });
    const outcome = await runStack(stack, runId, port);

    expect(outcome.status).toBe("build_failed");
    expect(outcome.failedStage).toBe("build");
    expect(outcome.screenshotArtifactId).toBeNull();

    const installCompleted = events.find((e) => e.type === "stage_completed" && e.stage === "install");
    expect(installCompleted).toMatchObject({ exitCode: 0 });

    const buildStartedIdx = events.findIndex((e) => e.type === "stage_started" && e.stage === "build");
    const buildFailedIdx = events.findIndex((e) => e.type === "stage_failed" && e.stage === "build");
    expect(buildStartedIdx).toBeGreaterThanOrEqual(0);
    expect(buildFailedIdx).toBeGreaterThan(buildStartedIdx);
    expect(events[buildFailedIdx]).toMatchObject({ stage: "build", exitCode: 1 });
  });

  it("keeps tmp/<runId> on a fatal install/build outcome (D2-05)", async () => {
    const scriptsDir = mkTmp("web-stack-evals-runstack-scripts-");
    const failScript = writeScript(scriptsDir, "fail.mjs", "process.exit(1);\n");
    const template = makeTemplate();
    const runId = trackRunId("t1d");
    const { port } = fakeStorage();

    const stack = baseStack(template, { install: `node ${failScript}` });
    await runStack(stack, runId, port);

    expect(existsSync(resolve("tmp", runId))).toBe(true);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("waitFor timed out");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const BUILD_OK_WITH_DIST = (distBytes: number) =>
  [
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "mkdirSync('dist', { recursive: true });",
    `writeFileSync('dist/index.html', 'x'.repeat(${distBytes}));`,
    "process.exit(0);",
  ].join("\n");

const SERVER_SCRIPT = [
  "import { createServer } from 'node:http';",
  "import { writeFileSync } from 'node:fs';",
  "const port = Number(process.argv[2]);",
  "const pidFile = process.argv[3];",
  "if (pidFile) writeFileSync(pidFile, String(process.pid));",
  "const server = createServer((req, res) => {",
  "  res.writeHead(200, { 'Content-Type': 'text/html' });",
  "  res.end('<html><body>ok</body></html>');",
  "});",
  "server.listen(port);",
].join("\n");

const HANG_SCRIPT = [
  "import { writeFileSync } from 'node:fs';",
  "const pidFile = process.argv[2];",
  "writeFileSync(pidFile, String(process.pid));",
  "setInterval(function(){}, 1000);",
].join("\n");

describe("runStack — non-fatal lint/test, dist size, readiness, screenshot, teardown", () => {
  it("records failing lint/test as non-fatal, still reaches completed with a screenshot + meta.json", async () => {
    const scriptsDir = mkTmp("web-stack-evals-runstack2-scripts-");
    const okScript = writeScript(scriptsDir, "ok.mjs", "process.exit(0);\n");
    const buildScript = writeScript(scriptsDir, "build.mjs", BUILD_OK_WITH_DIST(1234));
    const failScript = writeScript(scriptsDir, "fail.mjs", "process.exit(1);\n");
    const serverScript = writeScript(scriptsDir, "server.mjs", SERVER_SCRIPT);
    const pidFile = join(scriptsDir, "server.pid");
    const template = makeTemplate();
    const runId = trackRunId("t2a");
    const { port, events, artifacts } = fakeStorage();

    const stack = baseStack(template, {
      install: `node ${okScript}`,
      build: `node ${buildScript}`,
      lint: `node ${failScript}`,
      test: `node ${failScript}`,
      start: `node ${serverScript} 41401 ${pidFile}`,
      port: 41401,
    });

    const outcome = await runStack(stack, runId, port);

    expect(outcome.status).toBe("completed");
    expect(outcome.failedStage).toBeNull();
    expect(typeof outcome.screenshotArtifactId).toBe("string");

    const finishedEvents = events.filter((e) => e.type === "benchmark_finished");
    expect(finishedEvents).toHaveLength(1);
    expect(finishedEvents[0]).toMatchObject({ status: "completed", failedStage: null });

    expect(events.some((e) => e.type === "stage_failed" && e.stage === "lint")).toBe(true);
    expect(events.some((e) => e.type === "stage_failed" && e.stage === "test")).toBe(true);

    const meta = artifacts.find((a) => a.kind === "meta");
    expect(meta).toBeDefined();
    const parsed = JSON.parse(meta!.bytes.toString("utf8"));
    expect(parsed.distBytes).toBe(1234);
    expect(Array.isArray(parsed.pageErrors.consoleErrors)).toBe(true);

    expect(existsSync(resolve("tmp", runId))).toBe(false);

    await waitFor(() => !isAlive(Number(readFileSync(pidFile, "utf8"))));
  }, 20000);

  it("skips lint/test entirely when both fields are absent from the stack spec", async () => {
    const scriptsDir = mkTmp("web-stack-evals-runstack2-scripts-");
    const okScript = writeScript(scriptsDir, "ok.mjs", "process.exit(0);\n");
    const buildScript = writeScript(scriptsDir, "build.mjs", BUILD_OK_WITH_DIST(10));
    const serverScript = writeScript(scriptsDir, "server.mjs", SERVER_SCRIPT);
    const pidFile = join(scriptsDir, "server.pid");
    const template = makeTemplate();
    const runId = trackRunId("t2b");
    const { port, events } = fakeStorage();

    const stack = baseStack(template, {
      install: `node ${okScript}`,
      build: `node ${buildScript}`,
      start: `node ${serverScript} 41402 ${pidFile}`,
      port: 41402,
    });

    const outcome = await runStack(stack, runId, port);

    expect(outcome.status).toBe("completed");
    expect(events.some((e) => e.type === "stage_started" && (e.stage === "lint" || e.stage === "test"))).toBe(false);
  }, 20000);

  it("returns start_failed when the start process exits before ever answering HTTP 200", async () => {
    const scriptsDir = mkTmp("web-stack-evals-runstack2-scripts-");
    const okScript = writeScript(scriptsDir, "ok.mjs", "process.exit(0);\n");
    const buildScript = writeScript(scriptsDir, "build.mjs", BUILD_OK_WITH_DIST(5));
    const failScript = writeScript(scriptsDir, "fail.mjs", "process.exit(1);\n");
    const template = makeTemplate();
    const runId = trackRunId("t2c");
    const { port, events, artifacts } = fakeStorage();

    const stack = baseStack(template, {
      install: `node ${okScript}`,
      build: `node ${buildScript}`,
      start: `node ${failScript}`,
      port: 41403,
    });

    const outcome = await runStack(stack, runId, port);

    expect(outcome).toEqual({ runId, status: "start_failed", failedStage: "start", screenshotArtifactId: null });
    const finished = events.find((e) => e.type === "benchmark_finished");
    expect(finished).toMatchObject({ status: "start_failed", failedStage: "start" });
    expect(existsSync(resolve("tmp", runId))).toBe(true);

    const meta = artifacts.find((a) => a.kind === "meta");
    expect(meta).toBeDefined();
    expect(JSON.parse(meta!.bytes.toString("utf8")).distBytes).toBe(5);
  }, 10000);

  it("returns timeout/start and kills the subprocess when the server never answers within the start timeout", async () => {
    const scriptsDir = mkTmp("web-stack-evals-runstack2-scripts-");
    const okScript = writeScript(scriptsDir, "ok.mjs", "process.exit(0);\n");
    const buildScript = writeScript(scriptsDir, "build.mjs", BUILD_OK_WITH_DIST(5));
    const hangScript = writeScript(scriptsDir, "hang.mjs", HANG_SCRIPT);
    const pidFile = join(scriptsDir, "hang.pid");
    const template = makeTemplate();
    const runId = trackRunId("t2d");
    const { port, events } = fakeStorage();

    const stack = baseStack(template, {
      install: `node ${okScript}`,
      build: `node ${buildScript}`,
      start: `node ${hangScript} ${pidFile}`,
      startTimeoutMs: 300,
      port: 41404,
    });

    const outcome = await runStack(stack, runId, port);

    expect(outcome).toEqual({ runId, status: "timeout", failedStage: "start", screenshotArtifactId: null });
    const finished = events.find((e) => e.type === "benchmark_finished");
    expect(finished).toMatchObject({ status: "timeout", failedStage: "start" });

    await waitFor(() => existsSync(pidFile));
    const pid = Number(readFileSync(pidFile, "utf8"));
    await waitFor(() => !isAlive(pid));
  }, 15000);
});
