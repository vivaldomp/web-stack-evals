// Procedural PNG buffer generators for evaluator tests (no checked-in binary
// art, per 03-03-PLAN.md). Built directly on pngjs's PNG class -- no sharp
// needed here, these are synthetic fixtures, not real screenshots. Each
// fixture uses a deliberately different native size so evaluator tests
// exercise the dimension-mismatch normalization path (D3-05, Pitfall 1).
import { PNG } from "pngjs";

function setPixel(png: PNG, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  const idx = (png.width * y + x) * 4;
  png.data[idx] = r;
  png.data[idx + 1] = g;
  png.data[idx + 2] = b;
  png.data[idx + 3] = a;
}

/** ~30x20, a simple two-color vertical-split pattern. */
export function makeExpectedPng(): Buffer {
  const width = 30;
  const height = 20;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      setPixel(png, x, y, x < width / 2 ? 200 : 20, x < width / 2 ? 20 : 200, 20);
    }
  }
  return PNG.sync.write(png);
}

/** A different native size (32x18) with the same pattern shifted by a few pixels. */
export function makeGeneratedMatchPng(): Buffer {
  const width = 32;
  const height = 18;
  const shift = 2;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      setPixel(png, x, y, x < width / 2 + shift ? 200 : 20, x < width / 2 + shift ? 20 : 200, 20);
    }
  }
  return PNG.sync.write(png);
}

/** A third, differently-sized (28x22) buffer filled with an inverted/solid color. */
export function makeGeneratedDegradedPng(): Buffer {
  const width = 28;
  const height = 22;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      setPixel(png, x, y, 20, 20, 200);
    }
  }
  return PNG.sync.write(png);
}
