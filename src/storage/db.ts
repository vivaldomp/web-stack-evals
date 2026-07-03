import Database from "better-sqlite3";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.sql.js";
import type { AgentEvent, AgentEventDraft } from "../core/events.js";

/**
 * Opens the results DB, enables WAL + a defensive busy_timeout (D-16,
 * Pitfall 4 — single writer), and idempotently inits the schema guarded by
 * `user_version` (D-17): re-opening an existing DB never re-runs the DDL.
 */
export function openDb(file: string): Database.Database {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  const version = db.pragma("user_version", { simple: true }) as number;
  if (version < SCHEMA_VERSION) {
    db.exec(SCHEMA_SQL);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
  return db;
}

/** Promoted column (D-13): only ToolCallEvent carries a tool name. */
function toolNameOf(event: AgentEventDraft): string | null {
  return event.type === "tool_call" ? event.toolName : null;
}

const nextSeqSql = `SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM events WHERE run_id = @run_id`;

const insertEventSql = `
  INSERT INTO events (run_id, seq, type, ts, tool_name, payload)
  VALUES (@run_id, @seq, @type, @ts, @tool_name, @payload)
`;

/**
 * Appends one seqless draft to the canonical append-only log, stamping the next
 * per-run monotonic `seq` (D4-26) inside a transaction so the MAX(seq)-read +
 * INSERT are atomic under the single-writer WAL DB (D-16) — two producers can
 * interleave appends to one run with no collision or gap. The stamped seq is
 * embedded in the stored payload so `readEvents` round-trips a fully-formed
 * AgentEvent. Bound params only (T-1-SQL-01 — never string-concatenated SQL).
 * ponytail: MAX(seq)+1 in-txn is stateless and survives a mid-run restart;
 * upgrade to a per-run in-memory counter only if append throughput ever dominates.
 */
export function appendEvent(db: Database.Database, event: AgentEventDraft): void {
  const nextSeq = db.prepare(nextSeqSql);
  const insert = db.prepare(insertEventSql);
  db.transaction(() => {
    const { next } = nextSeq.get({ run_id: event.runId }) as { next: number };
    insert.run({
      run_id: event.runId,
      seq: next,
      type: event.type,
      ts: event.ts,
      tool_name: toolNameOf(event),
      payload: JSON.stringify({ ...event, seq: next }),
    });
  })();
}

/**
 * Reads back every event for a run in seq order (append order authoritative,
 * D-04) via a prepared SELECT, JSON.parse'd losslessly into an AgentEvent.
 */
export function readEvents(db: Database.Database, runId: string): AgentEvent[] {
  const rows = db
    .prepare("SELECT payload FROM events WHERE run_id = @run_id ORDER BY seq ASC")
    .all({ run_id: runId }) as { payload: string }[];
  return rows.map((row) => JSON.parse(row.payload) as AgentEvent);
}
