import { Result, TaggedError } from "better-result";

export type NotReadOnlyReason = "not_a_query" | "multiple_statements" | "forbidden_keyword";

// Why a statement was refused (spec §7.3, D12).
// BotObject.query() turns this into a throw at the RPC boundary.
// The message is what the MCP client sees.
// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError factory call, not a throw.
export class NotReadOnlySql extends TaggedError("NotReadOnlySql")<{
  reason: NotReadOnlyReason;
  message: string;
}> {}

// Leading whitespace, `-- line` comments and `/* block */` comments before the statement.
const LEADING_NOISE = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/,
  READ_ONLY_HEAD = /^(?:select|with|explain)\b/i,
  // `\b` treats `_` as a word character, so `\bpragma\b` would miss `pragma_table_info(...)`.
  // That is a real SQLite table-valued function that leaks PRAGMA data through a plain SELECT.
  // Excluding only letters and digits (not `_`) from the adjacency check catches it too.
  FORBIDDEN = /(?<![a-z0-9])(?:pragma|attach)(?![a-z0-9])/i,
  refuse = (reason: NotReadOnlyReason): Result<never, NotReadOnlySql> =>
    Result.err(
      new NotReadOnlySql({
        reason,
        message: `only a single SELECT / WITH / EXPLAIN statement is allowed (${reason})`,
      }),
    );

// Read-only guard for BotObject.query() (spec §7.3): one statement, starting with SELECT /
// WITH / EXPLAIN, no PRAGMA or ATTACH.
// SQLite cannot write through a SELECT, so this is sufficient.
// A `;` inside a string literal is rejected too; that is a deliberate simplification, not a bug.
// Ok carries the statement without its trailing `;`.
export function ensureReadOnly(sql: string): Result<string, NotReadOnlySql> {
  const body = sql.replace(LEADING_NOISE, "").trim(),
    statement = body.replace(/;\s*$/, "");
  if (!READ_ONLY_HEAD.test(body)) {
    return refuse("not_a_query");
  }
  if (statement.includes(";")) {
    return refuse("multiple_statements");
  }
  if (FORBIDDEN.test(statement)) {
    return refuse("forbidden_keyword");
  }
  return Result.ok(statement);
}
