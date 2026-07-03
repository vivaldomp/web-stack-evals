// AGENT-01 / D-23 structural guard: `src/agent/piAgentAdapter.ts` is the ONLY
// module under `src/**` allowed to import the Pi coding-agent SDK. This test walks
// the source tree (comment-stripped, so mentions in prose don't count) and fails
// if a second importer — or a stray `createAgentSession` reference — appears. It
// keeps guarding the boundary as later phases add code.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SDK = "@earendil-works/pi-coding-agent";
const PI_AGENT_ADAPTER = "src/agent/piAgentAdapter.ts";
// D5-14/AGENT-01: the SDK importer allowlist. modelCapabilities.ts is the SECOND
// allowlisted importer (the capability probe reads Pi's ModelRegistry); it never
// references createAgentSession, so session creation stays sole-sourced below.
const ALLOWED_IMPORTERS = ["src/agent/modelCapabilities.ts", PI_AGENT_ADAPTER];
const SRC_ROOT = join(import.meta.dirname, "..", "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Strip block + line comments so a package mention in prose never trips the guard.
 * Single combined pass: at each index a `//` line comment is matched before a
 * block comment, so a `/**`-looking token inside a `//` line (e.g. "src/**") is
 * consumed as the line comment and never opens a spurious block. */
function stripComments(src: string): string {
  return src.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
}

const repoRoot = join(import.meta.dirname, "..");
const files = walk(SRC_ROOT).map((f) => ({
  rel: relative(repoRoot, f).replace(/\\/g, "/"),
  code: stripComments(readFileSync(f, "utf8")),
}));

describe("AGENT-01 import boundary", () => {
  it("only the allowlisted src/agent modules import the Pi coding-agent SDK", () => {
    const importers = files
      .filter((f) => f.code.includes(`from "${SDK}"`) || f.code.includes(`require("${SDK}")`))
      .map((f) => f.rel)
      .sort();
    expect(importers).toEqual(ALLOWED_IMPORTERS.slice().sort());
  });

  it("createAgentSession is referenced only in piAgentAdapter.ts among src/**", () => {
    const refs = files
      .filter((f) => f.code.includes("createAgentSession"))
      .map((f) => f.rel)
      .sort();
    expect(refs).toEqual([PI_AGENT_ADAPTER]);
  });
});
