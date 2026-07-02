// D2-11 determinism controls: freeze time/random and kill CSS motion/caret at the
// context level (applies to every page created in that context), plus a page-scoped
// external-font-CDN blocker called once per page by playwrightRenderer.ts.

/**
 * Freezes Date/Date.now and Math.random on every page created in this context,
 * and injects CSS zeroing animation/transition durations + hiding the caret.
 * Both overrides run via context.addInitScript, which Playwright guarantees runs
 * "after the document was created but before any of its scripts were run."
 */
export async function installDeterminismControls(context: import("playwright").BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const fixedNow = 1735689600000; // frozen epoch ms, arbitrary fixed instant
    const OriginalDate = Date;
    // @ts-expect-error - deliberate override for determinism
    Date = class extends OriginalDate {
      constructor(...args: any[]) {
        // @ts-expect-error - forward to OriginalDate, defaulting to the frozen instant
        super(...(args.length ? args : [fixedNow]));
      }
      static now() {
        return fixedNow;
      }
    };
    let seed = 42;
    Math.random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
  });

  await context.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
    `;
    document.head?.appendChild(style) ?? document.documentElement.appendChild(style);
  });
}

/** Aborts requests to external font CDNs so a slow/varying webfont load can't shift layout. */
export async function blockExternalFonts(page: import("playwright").Page): Promise<void> {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort());
}
