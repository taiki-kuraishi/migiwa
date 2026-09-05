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
  // SQLite lets a with-clause open insert / update / delete statements too, so the leading
  // Keyword proves nothing for WITH: any write verb anywhere in the statement is refused.
  // Identifier boundaries keep `updated_at`, `end_reason` or 'GUILD_DELETE' from matching.
  WRITE_VERB =
    /(?<![a-z0-9_])(?:insert|update|delete|replace|drop|alter|create|vacuum|detach|reindex|savepoint|release)(?![a-z0-9_])/i,
  refuse = (reason: NotReadOnlyReason, message: string): Result<never, NotReadOnlySql> =>
    Result.err(new NotReadOnlySql({ reason, message }));

// First read-only layer for BotObject.query() (spec §7.3), a pure text check. Why each leading
// Keyword is allowed: SELECT cannot write; EXPLAIN only returns the VDBE program; WITH is
// Allowed only because WRITE_VERB refuses the insert / update / delete forms it can open. A `;`
// Inside a string literal is rejected too and a literal 'delete' trips WRITE_VERB; both are
// Deliberate over-refusals. The second layer (readOnlyExec in apps/bot) rolls back anything
// That still writes. Ok carries the statement without its trailing `;`.
export function ensureReadOnly(sql: string): Result<string, NotReadOnlySql> {
  const body = sql.replace(LEADING_NOISE, "").trim(),
    statement = body.replace(/;\s*$/, ""),
    forbiddenMatch = FORBIDDEN.exec(statement) ?? WRITE_VERB.exec(statement);
  if (!READ_ONLY_HEAD.test(body)) {
    return refuse("not_a_query", "only a single SELECT / WITH / EXPLAIN statement is allowed");
  }
  if (statement.includes(";")) {
    return refuse(
      "multiple_statements",
      "only one statement is allowed; remove the `;` (a `;` inside a string literal is refused too)",
    );
  }
  if (forbiddenMatch) {
    const keyword = forbiddenMatch[0].toLowerCase();
    return refuse(
      "forbidden_keyword",
      `the keyword \`${keyword}\` is not allowed anywhere in a query, even inside a string ` +
        `literal such as 'Update Squad'`,
    );
  }
  return Result.ok(statement);
}
