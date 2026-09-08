import type { DatabaseClient } from "@migiwa/db";
import type { SessionOp } from "@migiwa/sessionizer";

import { activity_sessions, presence_sessions, voice_sessions } from "@migiwa/db";
import { eq } from "drizzle-orm";

function applyOpen(db: DatabaseClient, op: Extract<SessionOp, { kind: "open" }>): void {
  if (op.table === "presence") {
    db.insert(presence_sessions).values(op.row).run();
  } else if (op.table === "activity") {
    db.insert(activity_sessions).values(op.row).run();
  } else {
    // Op.table is "voice" here (SessionTable's third and last member); a fourth member added to
    // SessionTable needs its own branch above, not a fallback into this one.
    db.insert(voice_sessions).values(op.row).run();
  }
}

function applyClose(db: DatabaseClient, op: Extract<SessionOp, { kind: "close" }>): void {
  const patch = { ended_at: op.ended_at, end_reason: op.end_reason };
  if (op.table === "presence") {
    db.update(presence_sessions).set(patch).where(eq(presence_sessions.id, op.id)).run();
  } else if (op.table === "activity") {
    db.update(activity_sessions).set(patch).where(eq(activity_sessions.id, op.id)).run();
  } else {
    // Op.table is "voice" here (SessionTable's third and last member); a fourth member added to
    // SessionTable needs its own branch above, not a fallback into this one.
    db.update(voice_sessions).set(patch).where(eq(voice_sessions.id, op.id)).run();
  }
}

function applyUpdate(db: DatabaseClient, op: Extract<SessionOp, { kind: "update" }>): void {
  if (op.table === "activity") {
    db.update(activity_sessions).set(op.patch).where(eq(activity_sessions.id, op.id)).run();
  } else {
    // Op.table is "voice" here ("update" only ever targets activity or voice, per SessionOp); a
    // Third "update"-able table needs its own branch above, not a fallback into this one.
    db.update(voice_sessions).set(op.patch).where(eq(voice_sessions.id, op.id)).run();
  }
}

// Turns the sessionizer's ops into Drizzle statements. Called inside the dispatch transaction,
// So a failure rolls back the whole event (spec §6.4). Ops run in array order: a voice move or a
// Presence status_change emits its close before its matching open for the same (guild_id, user_id),
// And each partial unique index (`WHERE ended_at IS NULL`) is checked statement-by-statement, so
// Opening ahead of the close it depends on collides with it instead of succeeding.
export function applyOps(db: DatabaseClient, ops: SessionOp[]): void {
  for (const op of ops) {
    if (op.kind === "open") {
      applyOpen(db, op);
    } else if (op.kind === "close") {
      applyClose(db, op);
    } else {
      applyUpdate(db, op);
    }
  }
}
