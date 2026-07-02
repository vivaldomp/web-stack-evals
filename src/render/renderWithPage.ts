// D-23/D2-21 isolation seam, second file explicitly permitted to import "playwright"
// (sibling to playwrightRenderer.ts, not a replacement of it). Unlike RenderPort's
// screenshot(), this keeps the browser/context/page open after returning so
// evaluators that need the live page (axe, DOM-presence — 03-04-PLAN.md) can run
// against it; the caller is responsible for invoking close().
import { chromium, type Page } from "playwright";
import type { RenderInput, RenderResult } from "../core/ports.js";
import { blockExternalFonts, installDeterminismControls } from "./determinism.js";

// Mirrors playwrightRenderer.ts's NAVIGATION_BUDGET_MS/SETTLE_MS (D2-10 DoS
// mitigation) — not imported, since playwrightRenderer.ts is out of this task's
// file scope and does not export them.
const NAVIGATION_BUDGET_MS = 12_000;
const SETTLE_MS = 250;

export interface LiveRenderResult extends RenderResult {
  page: Page;
  close: () => Promise<void>;
}

/**
 * Same render pass as createPlaywrightRenderer().screenshot(), except the
 * browser/context/page are NOT torn down before returning (D3-17) — the caller
 * gets a live `page` plus a `close()` to tear it down explicitly once done.
 */
export async function renderWithPage(input: RenderInput): Promise<LiveRenderResult> {
  const consoleErrors: string[] = [];
  const uncaughtExceptions: string[] = [];
  const failedRequests: string[] = [];

  const browser = await chromium.launch({ channel: "chromium", headless: true });
  const context = await browser.newContext({
    viewport: input.viewport,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await installDeterminismControls(context);
  const page = await context.newPage();
  await blockExternalFonts(page);

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  context.on("weberror", (webError) => uncaughtExceptions.push(String(webError.error())));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ""}`);
  });

  // Unlike the success path (where teardown is deliberately left to the caller's
  // close(), per D3-17), a setup/navigation failure means no LiveRenderResult is
  // ever returned — nobody will get a close() to call, so the browser/context
  // must be torn down here or they leak for the lifetime of the process.
  try {
    await Promise.race([
      page.goto(input.url, { waitUntil: "networkidle" }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Navigation exceeded ${NAVIGATION_BUDGET_MS}ms budget`)), NAVIGATION_BUDGET_MS),
      ),
    ]);
    await page.evaluate(() => document.fonts.ready);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    const png = await page.screenshot({ type: "png" });

    return {
      png,
      consoleErrors,
      uncaughtExceptions,
      failedRequests,
      page,
      close: async () => {
        await context.close();
        await browser.close();
      },
    };
  } catch (err) {
    await context.close();
    await browser.close();
    throw err;
  }
}
