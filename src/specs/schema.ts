import { z } from "zod";

/** Shared viewport shape used by stack + scenario specs. */
const ViewportSchema = z.strictObject({
  width: z.number().int(),
  height: z.number().int(),
});

/** Provenance of an expected screenshot (D-09) — both bytes and provenance are fingerprintable. */
export const ProvenanceSchema = z.strictObject({
  source: z.string(),
  tool: z.string(),
  version: z.string(),
  date: z.string(),
});

/** `stacks/<name>.yaml` (D-07/D-08) — template, commands, port, viewport. */
export const StackSchema = z.strictObject({
  template: z.string(),
  install: z.string(),
  build: z.string(),
  start: z.string(),
  /** Non-fatal metric stages (D2-14/D2-16) — absent field = stage skipped. */
  lint: z.string().optional(),
  test: z.string().optional(),
  /** Per-stage timeout overrides (D2-17) — absent falls back to runStack's built-in default. */
  installTimeoutMs: z.number().int().positive().optional(),
  buildTimeoutMs: z.number().int().positive().optional(),
  lintTimeoutMs: z.number().int().positive().optional(),
  testTimeoutMs: z.number().int().positive().optional(),
  startTimeoutMs: z.number().int().positive().optional(),
  screenshotTimeoutMs: z.number().int().positive().optional(),
  port: z.number().int().positive(),
  viewport: ViewportSchema,
});

/** `scenarios/<name>/<name>.yaml` (D-07/D-08/D-09) — prompt, expected screenshot + provenance, viewport, skills. */
export const ScenarioSchema = z.strictObject({
  prompt: z.string(),
  expected: z.strictObject({
    path: z.string(),
    provenance: ProvenanceSchema,
  }),
  viewport: ViewportSchema,
  skills: z.array(z.string()),
  /** DOM evaluator expected-elements (D3-08) — plain CSS selector strings. */
  expectedElements: z.array(z.string()).optional(),
  /** Per-evaluator composite weight overrides (D3-02) — composeScore renormalizes. */
  evaluatorWeights: z.record(z.string(), z.number()).optional(),
});

/** `models/<name>.json` (D-07/D-08, SPEC-03) — declarative model config, nothing hardcoded in core. */
export const ModelSchema = z.strictObject({
  provider: z.string(),
  modelId: z.string(),
  params: z.record(z.string(), z.unknown()),
});
