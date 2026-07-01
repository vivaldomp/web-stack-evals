import type Database from "better-sqlite3";
import { fingerprint, type Fingerprint, type FingerprintInputs } from "./fingerprint.js";
import type { Stack, Scenario, ModelConfig } from "../specs/types.js";

/**
 * Versions stamped explicitly and SEPARATELY from the fingerprint (D-12), so
 * a score change is attributable to an env change vs an input change.
 * Playwright/Chromium + live-model fields are injected by later phases
 * (Phase 1 has no browser, no agent) — see Open Question 1, resolved.
 * Do NOT import playwright or @earendil-works here (D-23).
 */
export interface VersionStamp {
  node: string;
  dependencies: Record<string, string> | { lockfileHash: string };
  playwright: string | null;
  chromium: string | null;
  modelId: string;
  modelParams: Record<string, unknown>;
}

/** Immutable manifest snapshot persisted to the runs row (D-18): spec snapshot + fingerprint + version stamp. */
export interface Manifest {
  runId: string;
  specSnapshot: { stack: Stack; scenario: Scenario; model: ModelConfig };
  fingerprint: Fingerprint;
  versionStamp: VersionStamp;
  createdAt: number;
}

export interface BuildManifestInput {
  runId: string;
  stack: Stack;
  scenario: Scenario;
  model: ModelConfig;
  prompt: string;
  mockup: Buffer;
  expected: Buffer;
  skills?: FingerprintInputs["skills"];
  versionStamp: VersionStamp;
}

/**
 * Folds the input fingerprint + injected VersionStamp + resolved spec
 * snapshot into a run manifest (SPEC-04, STORE-02). Never imports
 * Playwright or the Pi SDK (D-23) — the caller injects those versions.
 */
export function buildManifest(input: BuildManifestInput): Manifest {
  return {
    runId: input.runId,
    specSnapshot: { stack: input.stack, scenario: input.scenario, model: input.model },
    fingerprint: fingerprint({
      stack: input.stack,
      model: input.model,
      scenario: input.scenario,
      prompt: input.prompt,
      mockup: input.mockup,
      expected: input.expected,
      skills: input.skills,
    }),
    versionStamp: input.versionStamp,
    createdAt: Date.now(),
  };
}

const insertRunSql = `
  INSERT INTO runs (run_id, manifest, fingerprint, fingerprint_components, version_stamp, status, started_at)
  VALUES (@run_id, @manifest, @fingerprint, @fingerprint_components, @version_stamp, @status, @started_at)
`;

/**
 * Stamps the manifest onto the runs row (SC#3) via a prepared INSERT with
 * bound params only (T-1-SQL-03 — never string-concatenated SQL). Status
 * starts 'pending' — the run has not executed yet (D-19 owns the full
 * outcome enum).
 */
export function persistManifest(db: Database.Database, manifest: Manifest): void {
  db.prepare(insertRunSql).run({
    run_id: manifest.runId,
    manifest: JSON.stringify(manifest),
    fingerprint: manifest.fingerprint.top,
    fingerprint_components: JSON.stringify(manifest.fingerprint.components),
    version_stamp: JSON.stringify(manifest.versionStamp),
    status: "pending",
    started_at: manifest.createdAt,
  });
}
