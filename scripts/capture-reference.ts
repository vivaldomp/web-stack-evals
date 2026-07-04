/**
 * Capture reference screenshots for scenarios.
 *
 * Usage: tsx scripts/capture-reference.ts [scenario ...]   (default: all)
 *
 * For each scenario dir: compiles the shared Tailwind theme once, renders
 * scenarios/<name>/reference.html headlessly at the scenario's viewport,
 * writes expected.png and copies it to mockup.png.
 */
import { copyFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execa } from "execa";
import { chromium } from "playwright";
import { loadScenario } from "../src/specs/load.js";

const ROOT = resolve(import.meta.dirname, "..");
const SCENARIOS_DIR = join(ROOT, "scenarios");

const requested = process.argv.slice(2);
const scenarios = requested.length
  ? requested
  : readdirSync(SCENARIOS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
      .map((e) => e.name);

// Compile the shared Tailwind theme once per invocation.
await execa(
  "npx",
  [
    "@tailwindcss/cli",
    "-i", join(SCENARIOS_DIR, "_shared", "theme.tailwind.css"),
    "-o", join(SCENARIOS_DIR, "_shared", "theme.css"),
    "--minify",
  ],
  { cwd: ROOT, stdio: "inherit" },
);

const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  for (const name of scenarios) {
    const dir = join(SCENARIOS_DIR, name);
    const scenario = loadScenario(join(dir, `${name}.yaml`));

    const context = await browser.newContext({
      viewport: scenario.viewport,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(join(dir, "reference.html")).href, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ type: "png" });
    await context.close();

    writeFileSync(join(dir, "expected.png"), png);
    copyFileSync(join(dir, "expected.png"), join(dir, "mockup.png"));
    console.log(`captured ${name} (${scenario.viewport.width}x${scenario.viewport.height}, ${png.length} bytes)`);
  }
} finally {
  await browser.close();
}
