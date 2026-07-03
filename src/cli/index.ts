#!/usr/bin/env -S npx tsx
// The `bench` bin shim: the ONLY place the real orchestrator (05-06) + report
// renderer (05-05) are imported and the ONLY place process.exit is called —
// keeping cli.ts pure/testable. It just assembles the production deps and maps
// runCli's returned exit code (D5-08) to the process.
import { runCli } from "./cli.js";
import { runBenchmark } from "../orchestrator/run.js";
import { renderReport } from "../reports/renderReport.js";
import { openDb } from "../storage/db.js";

// Canonical results DB + artifact root (D5-15iv / RESEARCH A8).
runCli(process.argv.slice(2), {
  runBenchmark,
  renderReport,
  openDb,
  dbPath: "results/bench.sqlite",
  resultsRoot: "results",
}).then((code) => process.exit(code));
