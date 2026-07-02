import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { waitForHttp200 } from "../src/runtime/readiness.js";

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

describe("waitForHttp200", () => {
  it("resolves as soon as the URL answers HTTP 200", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolvePromise) => server!.listen(0, resolvePromise));
    const port = (server!.address() as { port: number }).port;

    await expect(waitForHttp200(`http://localhost:${port}`, 2000)).resolves.toBeUndefined();
  });

  it("throws once the deadline passes with nothing listening", async () => {
    await expect(waitForHttp200("http://localhost:1", 300)).rejects.toThrow(/never responded 200/);
  });
});
