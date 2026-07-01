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
});

/** `models/<name>.json` (D-07/D-08, SPEC-03) — declarative model config, nothing hardcoded in core. */
export const ModelSchema = z.strictObject({
  provider: z.string(),
  modelId: z.string(),
  params: z.record(z.string(), z.unknown()),
});
