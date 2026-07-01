import type { z } from "zod";
import type { StackSchema, ScenarioSchema, ModelSchema } from "./schema.js";

/** Typed spec objects the rest of the system consumes (SPEC-02) — no hardcoded stack/model/scenario in core. */
export type Stack = z.infer<typeof StackSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type ModelConfig = z.infer<typeof ModelSchema>;
