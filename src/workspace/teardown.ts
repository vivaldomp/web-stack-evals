import { rmSync } from "node:fs";
import { resolve } from "node:path";

/**
 * D2-05 retention: keep `tmp/<runId>/` on failure (`keep: true`, no-op),
 * delete it on success (`keep: false`). Idempotent — removing an already-gone
 * or never-created run dir never throws (`force: true`).
 */
export function cleanupWorkspace(runId: string, keep: boolean, tmpRoot: string = "tmp"): void {
  if (keep) return;
  rmSync(resolve(tmpRoot, runId), { recursive: true, force: true });
}
