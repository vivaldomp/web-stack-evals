import { randomBytes } from "node:crypto";

/**
 * A single sortable run id (D-22): `run-<YYYYMMDDHHMMSS>-<6 hex>`.
 * Reused verbatim as the DB primary key, the `tmp/<run_id>` workspace dir,
 * and the `results/<run_id>` artifact dir. Lexical sort == chronological order.
 */
export function newRunId(): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = randomBytes(3).toString("hex");
  return `run-${ts}-${suffix}`;
}
