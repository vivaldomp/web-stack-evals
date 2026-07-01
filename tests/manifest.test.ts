import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { canonicalJSON, fingerprint } from "../src/manifest/fingerprint.js";
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
