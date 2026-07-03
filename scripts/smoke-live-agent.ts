// Phase-4 live smoke test (04-UAT test 1 / AGENT-03).
// Throwaway driver: drives ONE real DeepSeek run through the actual
// createPiSession path to prove the Pi wiring lights up end-to-end.
// Makes a real paid call. Delete after the phase closes.
//
//   export DEEPSEEK_API_KEY=sk-...
//   npx tsx scripts/smoke-live-agent.ts
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
import { copyWorkspace } from "../src/workspace/copy.js";
import { runSession } from "../src/agent/piAgentAdapter.js";
import type { AgentInput } from "../src/agent/types.js";
import type { DurationMs, UsdCost } from "../src/core/units.js";

const runId = "smoke-" + process.pid;
const stack = parse(readFileSync("stacks/angular.yaml", "utf8"));
const scen = parse(readFileSync("tests/fixtures/scenarios/dashboard/dashboard.yaml", "utf8"));

// 1x1 placeholder mockup is fine — this is a wiring proof, not visual fidelity.
const workspacePath = copyWorkspace(stack.template, runId); // tmp/<runId>/angular
console.log("workspace:", workspacePath);

// The agent runs `npm run build` via bash, so node_modules must exist first
// (copyWorkspace deliberately excludes it).
execFileSync("npm", ["ci", "--ignore-scripts"], { cwd: workspacePath, stdio: "inherit" });

const input: AgentInput = {
  runId,
  workspacePath,
  promptText: scen.prompt,
  preamble: stack.preamble,
  mockupBytes: readFileSync("tests/fixtures/scenarios/dashboard/mockup.png"),
  mockupMimeType: "image/png",
  skillPaths: [],
  // Pi 0.80.3 registry knows only: deepseek-v4-flash | deepseek-v4-pro.
  model: { provider: "deepseek", modelId: "deepseek-v4-flash", temperature: 0 },
  budget: {
    maxWallClockMs: 600_000 as DurationMs,
    maxCostUsd: 1 as UsdCost,
    maxTurns: 40,
  },
};

let sawSessionStarted = false;
let sawFirstToken = false;
let totalCost = 0;

for await (const draft of runSession(input)) {
  console.log(draft.type, JSON.stringify(draft));
  if (draft.type === "session_started") sawSessionStarted = true;
  if (draft.type === "first_token") sawFirstToken = true;
  if (draft.type === "usage") totalCost += draft.costUsd;
}

console.log("\n--- smoke summary ---");
console.log("session_started:", sawSessionStarted);
console.log("first_token:", sawFirstToken);
console.log("total cost USD:", totalCost);
console.log("workspace (inspect for built files):", workspacePath);
