// EVAL-01/D3-05/D3-06/D3-07: PixelMatch evaluator. Both PNGs are UNCONDITIONALLY
// (not only on a detected size mismatch -- 03-RESEARCH.md Pitfall 1) resized to
// the stack viewport via sharp before pixelmatch ever sees them, since a
// mismatched or adversarially-sized PNG would otherwise crash pixelmatch. A
// diff PNG is always produced (D3-07) for debuggability. Pure Buffer-in
// /detail-out -- zero storage I/O; the caller (evaluateRun, 03-05-PLAN.md)
// persists detail.diffPng via linkDiffScreenshot.
import sharp from "sharp";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { EvaluatorPort } from "../core/ports.js";

export interface PixelMatchInput {
  expectedPng: Buffer;
  generatedPng: Buffer;
  viewport: { width: number; height: number };
}

async function normalizeToViewport(png: Buffer, viewport: { width: number; height: number }): Promise<Buffer> {
  return sharp(png)
    .resize(viewport.width, viewport.height, { fit: "fill" })
    .png()
    .toBuffer();
}

export function createPixelMatchEvaluator(): EvaluatorPort {
  return {
    name: "pixelmatch",
    async evaluate(rawInput: unknown) {
      const input = rawInput as PixelMatchInput;
      const { viewport } = input;

      const [expectedBuf, generatedBuf] = await Promise.all([
        normalizeToViewport(input.expectedPng, viewport),
        normalizeToViewport(input.generatedPng, viewport),
      ]);
      const expectedImg = PNG.sync.read(expectedBuf);
      const generatedImg = PNG.sync.read(generatedBuf);
      const diff = new PNG({ width: viewport.width, height: viewport.height });

      const mismatchedPixels = pixelmatch(
        expectedImg.data,
        generatedImg.data,
        diff.data,
        viewport.width,
        viewport.height,
        { threshold: 0.1, includeAA: false },
      );
      const totalPixels = viewport.width * viewport.height;

      return {
        rawScore: 1 - mismatchedPixels / totalPixels,
        detail: {
          mismatchedPixels,
          totalPixels,
          diffPng: PNG.sync.write(diff),
        },
      };
    },
  };
}
