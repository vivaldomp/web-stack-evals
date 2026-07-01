import { createHash } from "node:crypto";

/**
 * Input fingerprint algorithm v1 (D-10/11, SPEC-04): sha256 (node:crypto,
 * stdlib) over per-component content — resolved spec values via
 * `canonicalJSON` PLUS raw asset bytes, never paths — then sha256 over the
 * sorted "name:hash" component entries for the top-level fingerprint.
 * Bumping this algorithm is a methodology version bump; document any change
 * here rather than silently drifting.
 */

/** sha256 hex digest of a buffer or string (node:crypto stdlib — never hand-roll a hash). */
export function sha256(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Recursive sorted-key JSON.stringify: two values equal-by-value hash
 * equally regardless of source key order (no dependency needed — ~10 lines).
 */
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJSON(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Everything the agent sees for one run: resolved spec values + raw asset bytes (D-10). */
export interface FingerprintInputs {
  stack: unknown;
  model: unknown;
  scenario: unknown;
  prompt: string;
  mockup: Buffer;
  expected: Buffer;
  /** Raw bytes of each skill file, when the scenario references any (D-10). */
  skills?: Buffer[];
}

/** Top-level fingerprint + per-component hashes so a mismatch names which input changed (D-11). */
export interface Fingerprint {
  top: string;
  components: Record<string, string>;
}

export function fingerprint(inputs: FingerprintInputs): Fingerprint {
  const components: Record<string, string> = {
    stack: sha256(canonicalJSON(inputs.stack)),
    model: sha256(canonicalJSON(inputs.model)),
    scenario: sha256(canonicalJSON(inputs.scenario)),
    prompt: sha256(inputs.prompt),
    mockup: sha256(inputs.mockup),
    expected: sha256(inputs.expected),
  };

  if (inputs.skills && inputs.skills.length > 0) {
    // Sort by each file's own hash so the concatenation order is
    // deterministic regardless of the order skill files were read in.
    const sortedHashes = inputs.skills.map((buf) => sha256(buf)).sort();
    components.skills = sha256(sortedHashes.join(""));
  }

  const top = sha256(
    Object.keys(components)
      .sort()
      .map((name) => `${name}:${components[name]}`)
      .join("\n"),
  );

  return { top, components };
}
