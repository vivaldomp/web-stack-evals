import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAllowlistedEnv } from "../src/runtime/env.js";
import { runStage, startServer, killProcessTree, tailCap } from "../src/runtime/stage.js";

let dirs: string[] = [];

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function mkTmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
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

describe("buildAllowlistedEnv", () => {
  it("returns exactly the 5 allowlisted keys and excludes NODE_ENV", () => {
    const env = buildAllowlistedEnv("/tmp/fake-npm-cache");
    expect(Object.keys(env).sort()).toEqual(
      ["CI", "HOME", "PATH", "npm_config_cache", "npm_config_ignore_scripts"].sort(),
    );
    expect("NODE_ENV" in env).toBe(false);
    expect(env.npm_config_cache).toBe("/tmp/fake-npm-cache");
    expect(env.npm_config_ignore_scripts).toBe("true");
    expect(env.CI).toBe("1");
  });
});

describe("tailCap", () => {
  it("keeps only the tail bytes when text exceeds the cap", () => {
    const text = "0123456789ABCDEF";
    expect(tailCap(text, 10)).toBe("6789ABCDEF");
  });

  it("returns the text unchanged when under the cap", () => {
    expect(tailCap("short", 100)).toBe("short");
  });
});

describe("runStage", () => {
  const env = buildAllowlistedEnv("/tmp/fake-npm-cache");
  const cwd = process.cwd();

  it("returns exitCode 0 and captured stdout on a fast successful command", async () => {
    const fixtureDir = mkTmp("web-stack-evals-stage-fast-");
    const script = join(fixtureDir, "fast.mjs");
    writeFileSync(script, `console.log("hello-stage");\nprocess.exit(0);\n`);

    const outcome = await runStage("build", `node ${script}`, { cwd, env, timeoutMs: 10_000 });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.timedOut).toBe(false);
    expect(outcome.logTail).toContain("hello-stage");
  });

  it("returns timedOut true and a nonzero exitCode for a command exceeding timeoutMs, without throwing", async () => {
    const fixtureDir = mkTmp("web-stack-evals-stage-slow-");
    const script = join(fixtureDir, "slow.mjs");
    writeFileSync(script, `await new Promise((r) => setTimeout(r, 5000));\n`);

    const outcome = await runStage("build", `node ${script}`, { cwd, env, timeoutMs: 100 });

    expect(outcome.timedOut).toBe(true);
    expect(outcome.exitCode).not.toBe(0);
  });
});

describe("startServer / killProcessTree", () => {
  it("kills the whole process group, including a grandchild spawned by the started process", async () => {
    const fixtureDir = mkTmp("web-stack-evals-start-");
    const script = join(fixtureDir, "start.mjs");
    const pidFile = join(fixtureDir, "child.pid");
    writeFileSync(
      script,
      [
        "import { spawn } from 'node:child_process';",
        "import { writeFileSync } from 'node:fs';",
        "const pidFile = process.argv[2];",
        "const child = spawn(process.execPath, ['-e', 'setInterval(function(){}, 1000)'], { stdio: 'ignore' });",
        "writeFileSync(pidFile, String(child.pid));",
        "setInterval(function(){}, 1000);",
      ].join("\n"),
    );

    const env = buildAllowlistedEnv("/tmp/fake-npm-cache");
    const { subprocess } = startServer(`node ${script} ${pidFile}`, { cwd: process.cwd(), env });

    await waitFor(() => existsSync(pidFile));
    const childPid = Number(readFileSync(pidFile, "utf8"));
    expect(isAlive(childPid)).toBe(true);
    expect(subprocess.pid).toBeDefined();
    expect(isAlive(subprocess.pid!)).toBe(true);

    killProcessTree(subprocess);

    await waitFor(() => !isAlive(childPid) && !isAlive(subprocess.pid!));
    expect(isAlive(childPid)).toBe(false);
    expect(isAlive(subprocess.pid!)).toBe(false);
  });
});
