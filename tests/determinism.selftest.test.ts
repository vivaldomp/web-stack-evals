// BUILD-04 determinism self-test: proves the real RenderPort implementation
// (Task 2) plus its determinism controls (Task 1) hold to <=0.1% pixel drift
// across two screenshots of the same fixture. Serves the fixture via plain
// node:http (D2-08: the static-serve dev-dependency used by the template
// scaffold is scoped there, not to core).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { createPlaywrightRenderer } from "../src/render/playwrightRenderer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(join(__dirname, "fixtures/render/index.html"));

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(fixtureHtml);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected server.address() to return an AddressInfo");
  }
  port = address.port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe("determinism self-test (BUILD-04)", () => {
  it("screenshotting the fixture twice yields <=0.1% differing pixels", async () => {
    const renderer = createPlaywrightRenderer();
    const url = `http://localhost:${port}/`;
    const viewport = { width: 400, height: 300 };

    const shotA = await renderer.screenshot({ url, viewport });
    const shotB = await renderer.screenshot({ url, viewport });

    const imgA = PNG.sync.read(shotA.png);
    const imgB = PNG.sync.read(shotB.png);
    expect(imgA.width).toBe(imgB.width);
    expect(imgA.height).toBe(imgB.height);

    const { width, height } = imgA;
    const numDiffPixels = pixelmatch(imgA.data, imgB.data, undefined, width, height, {
      threshold: 0.1,
      includeAA: false,
    });
    const diffPct = (100 * numDiffPixels) / (width * height);
    expect(diffPct).toBeLessThanOrEqual(0.1);
  }, 30_000);
});
