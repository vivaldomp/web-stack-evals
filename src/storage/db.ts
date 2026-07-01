import Database from "better-sqlite3";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.sql.js";
import type { AgentEvent } from "../core/events.js";

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
function toolNameOf(event: AgentEvent): string | null {
  return event.type === "tool_call" ? event.toolName : null;
}

const insertEventSql = `
  INSERT INTO events (run_id, seq, type, ts, tool_name, payload)
  VALUES (@run_id, @seq, @type, @ts, @tool_name, @payload)
`;

/**
 * Appends one event to the canonical append-only log via a prepared
 * statement with bound params (T-1-SQL-01 — never string-concatenated SQL).
 * A duplicate (run_id, seq) violates the primary key: append order is
 * authoritative (D-04).
 */
export function appendEvent(db: Database.Database, event: AgentEvent): void {
  const insert = db.prepare(insertEventSql);
  db.transaction(() => {
    insert.run({
      run_id: event.runId,
      seq: event.seq,
      type: event.type,
      ts: event.ts,
      tool_name: toolNameOf(event),
      payload: JSON.stringify(event),
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
