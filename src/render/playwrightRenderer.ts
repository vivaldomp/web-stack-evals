// D-23/D2-21 isolation seam: the only file in the whole phase permitted to import
// the "playwright" package. RenderPort's caller (Plan 02-05's runStack) depends
// only on the RenderPort interface in src/core/ports.ts.
import { chromium } from "playwright";
import type { RenderInput, RenderPort, RenderResult } from "../core/ports.js";
import { blockExternalFonts, installDeterminismControls } from "./determinism.js";

const NAVIGATION_BUDGET_MS = 12_000;
const SETTLE_MS = 250;

/**
 * Creates a RenderPort backed by Playwright's bundled Chromium. Each screenshot()
 * call launches a fresh browser and always tears it down in a finally block, so no
 * browser process leaks between calls (v1 is single-sequential; no pooling).
 */
export function createPlaywrightRenderer(): RenderPort {
  return {
    async screenshot(input: RenderInput): Promise<RenderResult> {
      const consoleErrors: string[] = [];
      const uncaughtExceptions: string[] = [];
      const failedRequests: string[] = [];

      const browser = await chromium.launch({ channel: "chromium", headless: true });
      try {
        const context = await browser.newContext({
          viewport: input.viewport,
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
        });
        try {
          await installDeterminismControls(context);
          const page = await context.newPage();
          await blockExternalFonts(page);

          // D2-15: non-fatal page-error signals, registered before navigation.
          page.on("console", (msg) => {
            if (msg.type() === "error") consoleErrors.push(msg.text());
          });
          context.on("weberror", (webError) => uncaughtExceptions.push(String(webError.error())));
          page.on("requestfailed", (request) => {
            failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ""}`);
          });

          // D2-10 layered gate, Playwright-side half only: bounded so a page with a
          // perpetual background poll can't hang this layer past its own budget
          // (the HTTP-poll layer in Plan 02-05 already proved the server is up).
          await Promise.race([
            page.goto(input.url, { waitUntil: "networkidle" }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Navigation exceeded ${NAVIGATION_BUDGET_MS}ms budget`)), NAVIGATION_BUDGET_MS),
            ),
          ]);
          await page.evaluate(() => document.fonts.ready);
          await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

          const png = await page.screenshot({ type: "png" });
          return { png, consoleErrors, uncaughtExceptions, failedRequests };
        } finally {
          await context.close();
        }
      } finally {
        await browser.close();
      }
    },
  };
}
