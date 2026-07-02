// D3-17 coverage: proves renderWithPage() keeps its browser/context/page open
// after returning (unlike RenderPort.screenshot(), which tears down in a finally
// block) and that the caller-invoked close() actually closes the page, and that
// the D2-10 bounded-navigation DoS mitigation was carried over unchanged.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderWithPage } from "../src/render/renderWithPage.js";

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

describe("renderWithPage (D3-17)", () => {
  const viewport = { width: 400, height: 300 };

  it("resolves with a non-empty png and a still-open page", async () => {
    const url = `http://localhost:${port}/`;
    const result = await renderWithPage({ url, viewport });
    try {
      expect(result.png.length).toBeGreaterThan(0);
      expect(result.page.isClosed()).toBe(false);
    } finally {
      await result.close();
    }
  }, 30_000);

  it("close() tears down the browser/context so page.isClosed() becomes true", async () => {
    const url = `http://localhost:${port}/`;
    const result = await renderWithPage({ url, viewport });
    await result.close();
    expect(result.page.isClosed()).toBe(true);
  }, 30_000);

  it("rejects within the bounded navigation budget when navigation never resolves", async () => {
    const hangingServer = createServer(() => {
      // Deliberately never writes a response — request hangs forever, forcing
      // page.goto's "networkidle" wait to never settle on its own.
    });
    await new Promise<void>((resolve) => hangingServer.listen(0, resolve));
    const address = hangingServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected hangingServer.address() to return an AddressInfo");
    }
    const hangingPort = address.port;

    const start = Date.now();
    await expect(renderWithPage({ url: `http://localhost:${hangingPort}/`, viewport })).rejects.toThrow(
      /Navigation exceeded/,
    );
    const elapsedMs = Date.now() - start;
    // Bounded, not hanging indefinitely — allow generous slack above the 12s budget.
    expect(elapsedMs).toBeLessThan(20_000);

    await new Promise<void>((resolve, reject) => hangingServer.close((err) => (err ? reject(err) : resolve())));
  }, 30_000);
});
