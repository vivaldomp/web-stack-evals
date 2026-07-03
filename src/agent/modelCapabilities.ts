// AGENT-01 / D5-14: THIS IS THE SECOND (and only other) allowlisted src/**
// importer of the Pi coding-agent SDK — see tests/importBoundary.test.ts. It reads
// Pi's ModelRegistry to answer a single capability question and MUST NOT reference
// createAgentSession (session creation stays sole-sourced to piAgentAdapter.ts).
//
// Purpose (D5-01/D5-14): let the orchestrator skip the mockup image for a text-only
// model instead of paying for image tokens the model discards. The probe must live
// under src/agent because `model.input` is a Pi-typed field (RESEARCH gap A5).
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AgentModelSpec } from "./types.js";

/** The structural slice of a resolved Pi model this probe reads. Kept structural so
 * a fake resolver stands in for the registry in unit tests (no Pi runtime type). */
type ResolvedModel = { input?: string[] };

/** Resolves an {@link AgentModelSpec} to its model surface, or undefined if unknown. */
export type ModelResolver = (spec: AgentModelSpec) => ResolvedModel | undefined;

/** Default resolver: Pi's own ModelRegistry. AuthStorage.inMemory() carries no key —
 * no secret material enters this probe (D4-19). */
const piModelResolver: ModelResolver = (spec) =>
  ModelRegistry.create(AuthStorage.inMemory()).find(spec.provider, spec.modelId) as
    | ResolvedModel
    | undefined;

/**
 * D5-01/D5-14 capability probe: true iff the resolved model declares `image` input.
 * Unresolved / undefined model → false. `resolve` is injectable (default = the real
 * Pi registry) so the pure predicate is unit-testable with a fake resolver.
 */
export function modelAcceptsImage(
  spec: AgentModelSpec,
  resolve: ModelResolver = piModelResolver,
): boolean {
  return resolve(spec)?.input?.includes("image") ?? false;
}
