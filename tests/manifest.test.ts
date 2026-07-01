import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJSON, fingerprint } from "../src/manifest/fingerprint.js";
import { buildManifest, persistManifest, type VersionStamp } from "../src/manifest/manifest.js";
import { openDb } from "../src/storage/db.js";
import { loadStack, loadScenario, loadModel } from "../src/specs/load.js";

const FIXTURES = "tests/fixtures";

const stack = loadStack(`${FIXTURES}/stacks/angular.yaml`);
const scenario = loadScenario(`${FIXTURES}/scenarios/dashboard/dashboard.yaml`);
const model = loadModel(`${FIXTURES}/models/deepseek4pro.json`);
const mockup = readFileSync(`${FIXTURES}/scenarios/dashboard/mockup.png`);
const expected = readFileSync(`${FIXTURES}/scenarios/dashboard/expected.png`);

function buildFingerprint(mockupBytes: Buffer) {
  return fingerprint({
    stack,
    model,
    scenario,
    prompt: scenario.prompt,
    mockup: mockupBytes,
    expected,
  });
}

describe("canonicalJSON", () => {
  it("produces the same string regardless of key order", () => {
    expect(canonicalJSON({ a: 1, b: 2 })).toBe(canonicalJSON({ b: 2, a: 1 }));
  });
});

describe("fingerprint", () => {
  it("is stable: two calls over identical resolved specs + asset bytes are deep-equal", () => {
    const a = buildFingerprint(mockup);
    const b = buildFingerprint(mockup);
    expect(a).toEqual(b);
  });

  it("flipping one mockup byte changes top + components.mockup, leaves stack/model stable (D-11)", () => {
    const flipped = Buffer.from(mockup);
    flipped[0] = flipped[0] ^ 0xff;

    const original = buildFingerprint(mockup);
    const changed = buildFingerprint(flipped);

    expect(changed.top).not.toBe(original.top);
    expect(changed.components.mockup).not.toBe(original.components.mockup);
    expect(changed.components.stack).toBe(original.components.stack);
    expect(changed.components.model).toBe(original.components.model);
  });
});

describe("buildManifest / persistManifest", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tmpDbFile(): string {
    dir = mkdtempSync(join(tmpdir(), "web-stack-evals-manifest-test-"));
    return join(dir, "results.sqlite");
  }

  // Stub VersionStamp (D-12): node from process.version, model id/params from
  // the loaded ModelConfig; browser/live-model fields null in Phase 1.
  const versionStamp: VersionStamp = {
    node: process.version,
    dependencies: { lockfileHash: "stub" },
    playwright: null,
    chromium: null,
    modelId: model.modelId,
    modelParams: model.params,
  };

  function build(runId: string) {
    return buildManifest({
      runId,
      stack,
      scenario,
      model,
      prompt: scenario.prompt,
      mockup,
      expected,
      versionStamp,
    });
  }

  it("persists a manifest to the runs row and reads it back identically (SC#3)", () => {
    const db = openDb(tmpDbFile());
    const manifest = build("run-manifest-test-1");

    persistManifest(db, manifest);

    const row = db
      .prepare("SELECT fingerprint, manifest FROM runs WHERE run_id = ?")
      .get(manifest.runId) as { fingerprint: string; manifest: string };

    expect(row.fingerprint).toBe(manifest.fingerprint.top);
    expect(JSON.parse(row.manifest)).toEqual(manifest);
    db.close();
  });

  it("yields an equal fingerprint.top across two builds over identical inputs (SPEC-04 reproducibility)", () => {
    const a = build("run-manifest-test-2");
    const b = build("run-manifest-test-3");
    expect(a.fingerprint.top).toBe(b.fingerprint.top);
  });
});
