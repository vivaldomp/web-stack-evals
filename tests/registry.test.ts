// EVAL-05/D3-09/D3-15/D3-16 coverage: buildRegistry() is pure in-process
// composition -- this test only constructs and structurally inspects the
// returned EvaluatorPort[], it never calls .evaluate() (no real Chromium
// navigation, no real network call).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { openDb } from "../src/storage/db.js";
import { buildRegistry } from "../src/eval/registry.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  dir = mkdtempSync(join(tmpdir(), "web-stack-evals-registry-test-"));
  const db = openDb(join(dir, "results.sqlite"));
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const judgeModel = { provider: faux.provider.id, modelId: faux.getModel().id };
  return { db, models, judgeModel };
}

describe("buildRegistry (EVAL-05)", () => {
  it("omits the dom entry when expectedElements is absent (D3-09)", () => {
    const { db, models, judgeModel } = setup();

    const registry = buildRegistry({ db, models, expectedElements: undefined, judgeModel });

    expect(registry.map((e) => e.name).sort()).toEqual(["axe", "judge", "pixelmatch"]);
    db.close();
  });

  it("omits the dom entry when expectedElements is an explicitly empty array", () => {
    const { db, models, judgeModel } = setup();

    const registry = buildRegistry({ db, models, expectedElements: [], judgeModel });

    expect(registry.map((e) => e.name).sort()).toEqual(["axe", "judge", "pixelmatch"]);
    db.close();
  });

  it("includes the dom entry when expectedElements is non-empty", () => {
    const { db, models, judgeModel } = setup();

    const registry = buildRegistry({ db, models, expectedElements: ["nav"], judgeModel });

    expect(registry.map((e) => e.name).sort()).toEqual(["axe", "dom", "judge", "pixelmatch"]);
    db.close();
  });

  it("every returned entry satisfies the EvaluatorPort shape", () => {
    const { db, models, judgeModel } = setup();

    const registry = buildRegistry({ db, models, expectedElements: ["nav"], judgeModel });

    for (const entry of registry) {
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.evaluate).toBe("function");
    }
    db.close();
  });
});
