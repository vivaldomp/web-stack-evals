import { readFileSync } from "node:fs";
import { z } from "zod";
import YAML from "yaml";
import { StackSchema, ScenarioSchema, ModelSchema } from "./schema.js";
import type { Stack, Scenario, ModelConfig } from "./types.js";

/**
 * Parse-then-validate a spec file: on failure throw before any run starts
 * (D-08, SC#1), embedding the file path plus a Zod-4 multi-line
 * `z.prettifyError` message naming the offending key.
 */
function parseAndValidate<T>(path: string, raw: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid spec ${path}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Load + validate a `stacks/<name>.yaml` (SPEC-01/02). */
export function loadStack(path: string): Stack {
  const raw = YAML.parse(readFileSync(path, "utf8"));
  return parseAndValidate(path, raw, StackSchema);
}

/** Load + validate a `scenarios/<name>/<name>.yaml` (SPEC-01/02). */
export function loadScenario(path: string): Scenario {
  const raw = YAML.parse(readFileSync(path, "utf8"));
  return parseAndValidate(path, raw, ScenarioSchema);
}

/** Load + validate a `models/<name>.json` (SPEC-01/02/03). */
export function loadModel(path: string): ModelConfig {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return parseAndValidate(path, raw, ModelSchema);
}
