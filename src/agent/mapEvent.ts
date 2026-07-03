import type { AgentEventDraft } from "../core/events.js";
import type { EpochMs } from "../core/units.js";

// This module is a PURE per-event translator (AGENT-04): one Pi SDK event in,
// zero-or-more canonical `AgentEventDraft`s out. It holds no Pi session and does
// no I/O, so it never imports the Pi coding-agent SDK package — it reads only
// structural fields off `PiEvent`, which keeps its whole behavior unit-testable
// from hand-authored fake events with an injected clock (no network, no cost).

/** Per-run identity + injectable clock. `now` defaults to `Date.now` (D4-10). */
export interface EventMapperContext {
  runId: string;
  provider: string;
  modelId: string;
  now?: () => EpochMs;
}

/**
 * Narrow structural input: a Pi event is just a tagged bag of fields. Typing it
 * this loosely is deliberate — the mapper reaches only for the handful of fields
 * the RESEARCH mapping table names, and tests author plain objects with no Pi
 * import. Unknown types fall through to the D-02 passthrough arm.
 */
export type PiEvent = { type: string } & Record<string, unknown>;

/** Translate one Pi event into zero-or-more canonical drafts. Never returns null. */
export type EventMapper = (piEvent: PiEvent) => AgentEventDraft[];

/**
 * Build a stateful per-run mapper. Closes over three pieces of run state: the
 * once-only `session_started` latch, the once-only `first_token` latch, and the
 * `toolArgs` cache that pairs `tool_execution_start.args` with its later `_end`.
 */
export function createEventMapper(ctx: EventMapperContext): EventMapper {
  const now = ctx.now ?? Date.now;
  let sessionStarted = false;
  let firstTokenEmitted = false;
  const toolArgs = new Map<string, unknown>();

  return function mapEvent(piEvent: PiEvent): AgentEventDraft[] {
    const ts = now();
    const base = { runId: ctx.runId, ts };

    switch (piEvent.type) {
      case "agent_start": {
        if (sessionStarted) return [];
        sessionStarted = true;
        return [{ ...base, type: "session_started", provider: ctx.provider, modelId: ctx.modelId }];
      }

      case "message_update": {
        // Narration/reasoning is always preserved verbatim (D4-12).
        const unknown: AgentEventDraft = { ...base, type: "unknown", piType: "message_update", raw: piEvent };
        const asst = piEvent.assistantMessageEvent as { type?: string } | undefined;
        if (!firstTokenEmitted && asst?.type === "text_delta") {
          firstTokenEmitted = true;
          return [{ ...base, type: "first_token" }, unknown];
        }
        return [unknown];
      }

      case "turn_end": {
        const message = piEvent.message as {
          stopReason?: string;
          usage: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
            reasoning?: number;
            totalTokens: number;
            cost: { total: number };
          };
        };
        const usage = message.usage;
        return [
          {
            ...base,
            type: "usage",
            inputTokens: usage.input,
            outputTokens: usage.output,
            cacheReadTokens: usage.cacheRead,
            cacheWriteTokens: usage.cacheWrite,
            reasoningTokens: usage.reasoning,
            totalTokens: usage.totalTokens,
            costUsd: usage.cost.total, // verbatim — never pre-rounded (D-26)
            aborted: message.stopReason === "aborted", // D4-15
          },
        ];
      }

      case "tool_execution_start":
        return onToolStart(piEvent, toolArgs);

      case "tool_execution_end":
        return onToolEnd(piEvent, toolArgs, base);

      default:
        // ponytail: default arm is the D-02 safety net — any Pi type we never
        // promote still lands as a faithful UnknownEvent.
        return [{ ...base, type: "unknown", piType: piEvent.type, raw: piEvent }];
    }
  };
}

// --- tool arms (filled in Task 2) ---------------------------------------------

function onToolStart(_piEvent: PiEvent, _toolArgs: Map<string, unknown>): AgentEventDraft[] {
  return [];
}

function onToolEnd(
  _piEvent: PiEvent,
  _toolArgs: Map<string, unknown>,
  _base: { runId: string; ts: EpochMs },
): AgentEventDraft[] {
  return [];
}
