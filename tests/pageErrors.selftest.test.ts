// D2-15 coverage: proves the RenderPort actually CAPTURES non-fatal page-error
// signals. The determinism/integration tests only ever render error-free pages,
// so they assert the three arrays are arrays but never that they populate. This
// test serves a page that emits a console error, an uncaught exception, and a
// failed network request, then asserts each array is non-empty while the
// screenshot still resolves (capture is non-fatal — it never blocks the shot).
// Serves the page via node:http, same pattern as determinism.selftest.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createPlaywrightRenderer } from "../src/render/playwrightRenderer.js";

// Three separate top-level scripts so the throw in the last one does not stop the
// earlier two from running. The fetch targets port 1 (connection refused) to force
// a genuine network failure — a 404 would be a successful response, not a failed
// request, so it would NOT fire Playwright's "requestfailed".
const ERROR_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>page-error fixture</title></head>
<body>
  <p>page-error fixture</p>
  <script>console.error("intentional console error for D2-15 test");</script>
  <script>fetch("http://127.0.0.1:1/unreachable").catch(function () {});</script>
  <script>throw new Error("intentional uncaught exception for D2-15 test");</script>
</body>
</html>`;

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(ERROR_PAGE);
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

describe("page-error capture self-test (D2-15)", () => {
  it("populates the RenderResult error arrays while the screenshot still resolves", async () => {
    const renderer = createPlaywrightRenderer();
    const result = await renderer.screenshot({
      url: `http://localhost:${port}/`,
      viewport: { width: 400, height: 300 },
    });

    // Screenshot is still produced — page errors are non-fatal.
    expect(result.png.length).toBeGreaterThan(0);

    // All three D2-15 signals were captured.
    expect(result.consoleErrors.some((e) => e.includes("intentional console error"))).toBe(true);
    expect(result.uncaughtExceptions.some((e) => e.includes("intentional uncaught exception"))).toBe(true);
    expect(result.failedRequests.some((r) => r.includes("127.0.0.1:1"))).toBe(true);
  }, 30_000);
});
