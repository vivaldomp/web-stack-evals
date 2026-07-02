import { describe, it, expect, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyWorkspace } from "../src/workspace/copy.js";
import { cleanupWorkspace } from "../src/workspace/teardown.js";

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

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out.sort();
}

describe("copyWorkspace", () => {
  it("copies template files into tmp/<runId>/angular, excludes node_modules, leaves source untouched", () => {
    const templateDir = mkTmp("web-stack-evals-tpl-");
    writeFileSync(join(templateDir, "package.json"), '{"name":"tpl"}');
    mkdirSync(join(templateDir, "src"), { recursive: true });
    writeFileSync(join(templateDir, "src", "main.ts"), "console.log('hi')");
    mkdirSync(join(templateDir, "node_modules", "some-pkg"), { recursive: true });
    writeFileSync(join(templateDir, "node_modules", "some-pkg", "index.js"), "module.exports = {}");

    const beforeFiles = listFilesRecursive(templateDir);
    const beforeContents = beforeFiles.map((f) => readFileSync(f));

    const tmpRoot = mkTmp("web-stack-evals-runs-");
    const runId = "run-test-1";

    const runDir = copyWorkspace(templateDir, runId, tmpRoot);

    expect(runDir).toBe(join(tmpRoot, runId, "angular"));
    expect(readFileSync(join(runDir, "package.json"), "utf8")).toBe('{"name":"tpl"}');
    expect(readFileSync(join(runDir, "src", "main.ts"), "utf8")).toBe("console.log('hi')");
    expect(existsSync(join(runDir, "node_modules"))).toBe(false);

    const afterFiles = listFilesRecursive(templateDir);
    expect(afterFiles).toEqual(beforeFiles);
    const afterContents = afterFiles.map((f) => readFileSync(f));
    expect(afterContents).toEqual(beforeContents);
  });
});

describe("cleanupWorkspace", () => {
  it("removes the run dir when keep is false, and is idempotent on a missing dir", () => {
    const templateDir = mkTmp("web-stack-evals-tpl2-");
    writeFileSync(join(templateDir, "a.txt"), "a");
    const tmpRoot = mkTmp("web-stack-evals-runs2-");
    const runId = "run-test-2";
    copyWorkspace(templateDir, runId, tmpRoot);

    cleanupWorkspace(runId, false, tmpRoot);
    expect(existsSync(join(tmpRoot, runId))).toBe(false);

    expect(() => cleanupWorkspace(runId, false, tmpRoot)).not.toThrow();
  });

  it("keeps the run dir when keep is true", () => {
    const templateDir = mkTmp("web-stack-evals-tpl3-");
    writeFileSync(join(templateDir, "a.txt"), "a");
    const tmpRoot = mkTmp("web-stack-evals-runs3-");
    const runId = "run-test-3";
    copyWorkspace(templateDir, runId, tmpRoot);

    cleanupWorkspace(runId, true, tmpRoot);
    expect(existsSync(join(tmpRoot, runId))).toBe(true);
  });
});
