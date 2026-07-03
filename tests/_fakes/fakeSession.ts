// Scriptable `SessionLike` double: replays a fixed `PiEvent[]` through the
// captured subscribe listener, then settles — zero network, zero paid tokens.
// This is the substitute the adapter's injectable SessionFactory seam accepts, so
// the whole event-stream behaviour of `runSession` is validated without Pi.
import type { SessionLike } from "../../src/agent/piAgentAdapter.js";
import type { PiEvent } from "../../src/agent/mapEvent.js";

type ImageAttachment = { type: "image"; data: string; mimeType: string };

export interface FakeCalls {
  prompts: Array<{ text: string; opts: { images: ImageAttachment[] } }>;
  subscribeCount: number;
  unsubscribeCount: number;
  abortCount: number;
  disposeCount: number;
  statsCount: number;
}

export interface FakeSessionOptions {
  /** prompt() rejects with this AFTER replaying the script — a fatal agent error (D4-14). */
  rejectPromptWith?: Error;
  /** Fixed value returned by getSessionStats().cost (overridden by `costPerTurn` once any turn_end replays). */
  cost?: number;
  /** Advance the cumulative getSessionStats().cost by this amount BEFORE dispatching each `turn_end` — drives the `usd` ceiling + reconciliation delta scriptably. */
  costPerTurn?: number;
  /** prompt() blocks on this promise after emitting `gateAfter` events, before the rest — proves live streaming. */
  gate?: Promise<void>;
  gateAfter?: number;
  /** prompt() settles only after abort() is invoked — drives the wall-clock ceiling with NO events flowing. */
  hang?: boolean;
}

export function makeFakeSession(
  script: PiEvent[],
  options: FakeSessionOptions = {},
): { session: SessionLike; calls: FakeCalls } {
  const calls: FakeCalls = {
    prompts: [],
    subscribeCount: 0,
    unsubscribeCount: 0,
    abortCount: 0,
    disposeCount: 0,
    statsCount: 0,
  };
  let listener: ((e: PiEvent) => void) | null = null;
  // Cumulative cost the fake reports; advanced by `costPerTurn` per replayed turn_end.
  let cumulativeCost = options.costPerTurn !== undefined ? 0 : (options.cost ?? 0);
  const usesCostPerTurn = options.costPerTurn !== undefined;
  // hang mode: prompt() blocks until abort() releases it.
  let releaseHang: (() => void) | null = null;
  const hangPromise = options.hang ? new Promise<void>((r) => (releaseHang = r)) : null;

  const session: SessionLike = {
    subscribe(l) {
      calls.subscribeCount++;
      listener = l;
      return () => {
        calls.unsubscribeCount++;
      };
    },
    async prompt(text, opts) {
      calls.prompts.push({ text, opts });
      let i = 0;
      for (const e of script) {
        // Own microtask turn per event → streaming is observably incremental.
        await Promise.resolve();
        // Advance the reported cost BEFORE the listener reads getSessionStats()
        // for this turn — so the usd ceiling sees the post-turn cumulative.
        if (e.type === "turn_end" && options.costPerTurn !== undefined) {
          cumulativeCost += options.costPerTurn;
        }
        listener?.(e);
        i++;
        if (options.gate && i === (options.gateAfter ?? 1)) {
          await options.gate;
        }
      }
      await Promise.resolve();
      if (hangPromise) await hangPromise;
      if (options.rejectPromptWith) throw options.rejectPromptWith;
    },
    async abort() {
      calls.abortCount++;
      releaseHang?.();
    },
    getSessionStats() {
      calls.statsCount++;
      // A test may want the final reconciliation cost to exceed Σ per-turn usage:
      // `cost` (when > cumulative) acts as the authoritative final total.
      if (!usesCostPerTurn) return { cost: options.cost ?? 0 };
      return { cost: options.cost !== undefined && options.cost > cumulativeCost ? options.cost : cumulativeCost };
    },
    dispose() {
      calls.disposeCount++;
    },
  };

  return { session, calls };
}

/** Build a `createSession` factory that ignores its input and returns the fake. */
export function fakeFactory(
  script: PiEvent[],
  options?: FakeSessionOptions,
): { createSession: () => Promise<SessionLike>; calls: FakeCalls } {
  const { session, calls } = makeFakeSession(script, options);
  return { createSession: async () => session, calls };
}
