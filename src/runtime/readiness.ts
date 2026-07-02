/**
 * D2-10 layered readiness gate, HTTP-poll half only: bounded poll of `url`
 * until it answers HTTP 200, backing off 250ms between attempts. Native
 * `fetch` + `AbortSignal.timeout` (stdlib since Node 17.3/18) — no library,
 * per 02-RESEARCH.md's "Don't Hand-Roll" table this is intentionally ~15
 * lines.
 */
export async function waitForHttp200(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) return;
    } catch (err) {
      lastError = err; // server not up yet — expected during early polling
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server never responded 200 within ${timeoutMs}ms: ${String(lastError)}`);
}
