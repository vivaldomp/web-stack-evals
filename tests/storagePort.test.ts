import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/storage/db.js";
import { getArtifactPath } from "../src/storage/artifacts.js";
import { createStoragePort } from "../src/storage/storagePort.js";
import type { StoragePort } from "../src/core/ports.js";
import type { AgentEvent } from "../src/core/events.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  dir = mkdtempSync(join(tmpdir(), "web-stack-evals-storageport-test-"));
  const db = openDb(join(dir, "results.sqlite"));
  const resultsRoot = join(dir, "results");
  const port: StoragePort = createStoragePort(db, resultsRoot);
  return { db, resultsRoot, port };
}

describe("createStoragePort", () => {
  it("writeArtifact returns a string id that round-trips through getArtifactPath", () => {
    const { db, port } = setup();
    const bytes = Buffer.from("abc");

    const id = port.writeArtifact("run-1", "screenshot", "x.png", bytes);
    expect(typeof id).toBe("string");

    const viaPort = port.getArtifactPath(id);
    const viaConcrete = getArtifactPath(db, Number(id));
    expect(viaPort).toBe(viaConcrete);
    expect(viaPort).toBe(join("run-1", "x.png"));
    db.close();
  });

  it("appendEvent + readEvents round-trip losslessly", () => {
    const { db, port } = setup();
    const event: AgentEvent = {
      type: "stage_started",
      runId: "run-1",
      seq: 0,
      ts: 0,
      stage: "install",
    };

    port.appendEvent(event);
    const result = port.readEvents("run-1");
    expect(result).toEqual([event]);
    db.close();
  });

  it("getArtifactPath returns null for an unknown id", () => {
    const { port, db } = setup();
    expect(port.getArtifactPath("999999")).toBeNull();
    db.close();
  });
});
