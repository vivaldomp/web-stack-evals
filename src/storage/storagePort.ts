import type Database from "better-sqlite3";
import type { StoragePort } from "../core/ports.js";
import type { Manifest } from "../manifest/manifest.js";
import { appendEvent, readEvents } from "./db.js";
import { getArtifactPath, writeArtifact } from "./artifacts.js";
import { persistManifest } from "../manifest/manifest.js";

/**
 * Adapts Phase 1's concrete `db`-taking storage functions to the `StoragePort`
 * seam `runStack` (Plan 02-05) consumes. Delegates every method verbatim to
 * the existing functions with `db` (and `resultsRoot` where accepted) bound
 * via closure — no Phase-1 file's signature changes.
 *
 * The only real work here is a single deliberate shim at the id-type seam:
 * `writeArtifact`/`getArtifactPath` in `src/storage/artifacts.ts` use a
 * numeric row id, while the `StoragePort` interface declares a `string` id.
 * That conversion happens here, not by loosening `artifacts.ts`.
 */
export function createStoragePort(db: Database.Database, resultsRoot?: string): StoragePort {
  return {
    appendEvent: (e) => appendEvent(db, e),
    readEvents: (runId) => readEvents(db, runId),
    writeArtifact: (runId, kind, filename, bytes) =>
      String(writeArtifact(db, runId, kind, filename, bytes, resultsRoot)),
    getArtifactPath: (id) => getArtifactPath(db, Number(id)),
    persistManifest: (m) => persistManifest(db, m as Manifest),
  };
}
