import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
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
