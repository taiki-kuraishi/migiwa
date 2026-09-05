import type { QueryResult } from "@migiwa/gateway";

// Rows a single query() may return (spec §7.3).
const MAX_ROWS = 10_000;

// Second read-only layer (spec §7.3): whatever the text guard in @migiwa/db missed, a statement
// That wrote rows is rolled back here. `rowsWritten` is SQLite's own count, so this does not
// Depend on parsing SQL correctly — it would have caught the WITH-hides-a-write bypass without
// Knowing SQLite's grammar. The `break` at MAX_ROWS is deliberately not a full drain: it is the
// Only CPU bound a query has. That is safe because layer 2 does not depend on layer 1 draining
// The cursor: a write statement that returns rows (`… RETURNING`) sets `rowsWritten >= 1` before
// Its first row is yielded, and one that returns none finishes the loop before it starts either
// Way. Throwing inside `transactionSync` rolls the transaction back.
export function readOnlyExec(storage: DurableObjectStorage, statement: string): QueryResult {
  return storage.transactionSync(() => {
    const cursor = storage.sql.exec(statement),
      rows: SqlStorageValue[][] = [];
    let truncated = false;
    for (const row of cursor.raw()) {
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        break;
      }
      rows.push(row);
    }
    if (cursor.rowsWritten > 0) {
      throw new Error(
        `statement wrote ${cursor.rowsWritten} rows and was rolled back; only reads are allowed`,
      );
    }
    return { columns: cursor.columnNames, rows, rows_read: cursor.rowsRead, truncated };
  });
}
