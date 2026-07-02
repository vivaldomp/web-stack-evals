import { cpSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";

/**
 * Copies `templateDir` into `tmp/<runId>/angular/` (D2-01/D2-06) and returns
 * the absolute destination path. The destination is derived only from the
 * fixed `tmpRoot` root + `runId` + a fixed `"angular"` subfolder — never from
 * any other input — so isolation holds by construction.
 *
 * `node_modules` is excluded from the copy: the destination gets its own via
 * the install stage, and copying it would be slow and pointless.
 */
export function copyWorkspace(templateDir: string, runId: string, tmpRoot: string = "tmp"): string {
  const runDir = resolve(tmpRoot, runId, "angular");
  mkdirSync(runDir, { recursive: true });
  cpSync(templateDir, runDir, {
    recursive: true,
    filter: (src) => basename(src) !== "node_modules",
  });
  return runDir;
}
