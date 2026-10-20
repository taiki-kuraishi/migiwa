import { Result } from "better-result";

import type { PresenceUpdate } from "./types";

import { pageSize, presenceStatuses, requestTimeout } from "./constants";
import { BasinSqlRequestError, BasinSqlResponseError } from "./errors";

/**
 * Basin SQL の REST API で、raw event の table（infra/cloudflare の discord.events_v1）を読む。Basin SQL には
 * Worker の binding が無い。
 */
export class BasinSqlClient {
  private readonly endpoint: string;
  private readonly token: string;

  /**
   * Basin Catalog の account・bucket と、読み取り専用の token を受け取る。
   */
  public constructor(args: { accountId: string; bucket: string; token: string }) {
    this.endpoint = `https://api.sql.cloudflarestorage.com/api/v1/accounts/${args.accountId}/basin-sql/query/${args.bucket}`;
    this.token = args.token;
  }

  /**
   * POST /basin-sql/query/{bucket} で、[from, to) に受けた PRESENCE_UPDATE を (受けた時刻, user, status) の順に
   * すべて返す。1 回の query は LIMIT の上限（pageSize 件）までしか返さないので、ページをたどって読む。
   */
  public async findPresenceUpdates(args: { from: Date; to: Date }) {
    return this.findPresenceUpdatesAfter({ ...args, after: undefined });
  }

  /**
   * After より後ろの行を、最後のページまでたどって返す。
   * 1. After より後ろの 1 ページを読む
   * 2. pageSize 件に満たなければ最後のページなので、そのまま返す
   * 3. ページの最後の行より後ろを読み、つなげて返す
   */
  // 自分を呼ぶので、戻り値の型を推論できない。
  private async findPresenceUpdatesAfter(args: {
    from: Date;
    to: Date;
    after: PresenceUpdate | undefined;
  }): Promise<Result<PresenceUpdate[], BasinSqlRequestError | BasinSqlResponseError>> {
    return Result.gen(async function* () {
      // Step 1: After より後ろの 1 ページを読む
      const page = yield* await this.query({ query: this.presenceUpdatesQuery(args) });

      // Step 2: pageSize 件に満たなければ最後のページなので、そのまま返す
      if (page.length < pageSize) {
        return Result.ok(page);
      }

      // Step 3: ページの最後の行より後ろを読み、つなげて返す
      const rest = yield* await this.findPresenceUpdatesAfter({ ...args, after: page.at(-1) });
      return Result.ok([...page, ...rest]);
    }, this);
  }

  /**
   * Query を 1 回送り、行を PresenceUpdate の配列に読む。
   * 1. Query を送る。届かなければ BasinSqlRequestError を返す
   * 2. 成功の応答でなければ BasinSqlResponseError を返す
   * 3. 行を PresenceUpdate に読み、読めない行があれば BasinSqlResponseError を返す
   */
  private async query(args: { query: string }) {
    return Result.gen(async function* () {
      // Step 1: Query を送る。届かなければ BasinSqlRequestError を返す
      const response = yield* await Result.tryPromise({
        try: async () =>
          fetch(this.endpoint, {
            method: "POST",
            headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
            body: JSON.stringify(args),
            signal: AbortSignal.timeout(requestTimeout),
          }),
        catch: (cause) =>
          new BasinSqlRequestError({ cause, message: "Failed to send the Basin SQL query" }),
      });

      // Step 2: 成功の応答でなければ BasinSqlResponseError を返す
      // 失敗の応答も JSON（{ success: false, errors }）で返るので、本文をそのまま message に残す。
      const text = yield* await Result.tryPromise({
        try: async () => response.text(),
        catch: (cause) =>
          new BasinSqlRequestError({ cause, message: "Failed to read the Basin SQL response" }),
      });

      if (!response.ok) {
        return Result.err(
          new BasinSqlResponseError({
            status: response.status,
            message: `Basin SQL query failed: ${text}`,
          }),
        );
      }

      // Step 3: 行を PresenceUpdate に読み、読めない行があれば BasinSqlResponseError を返す
      return Result.try({
        try: () => this.presenceUpdates(JSON.parse(text)),
        catch: (cause) =>
          new BasinSqlResponseError({
            status: response.status,
            message: `Basin SQL returned an unreadable response: ${String(cause)}`,
          }),
      });
    }, this);
  }

  /**
   * [from, to) の PRESENCE_UPDATE を、重複を除いて読む SQL を作る。
   */
  private presenceUpdatesQuery(args: { from: Date; to: Date; after: PresenceUpdate | undefined }) {
    const status = "json_get_str(payload, 'status')";
    // Table は __ingest_ts の日で分割されているので、__ingest_ts でも絞って読む file を減らす。ingest は受けた
    // 後なので from より前は要らないが、時計のずれで落とさないよう 1 時間の余裕を持たせる。
    const ingestFrom = new Date(args.from.getTime() - 3_600_000).toISOString();
    // DISTINCT: 列がすべて同じ行を 1 つにする。
    // QUALIFY: Pipelines は at-least-once なので、同じ dispatch（session_id, seq）の行を 1 つにする。
    // ORDER BY: ページの境目で行を飛ばさないよう、DISTINCT の後で一意になる列の並びにする。
    return `SELECT DISTINCT user_id, received_at, ${status} AS status, session_id, seq
FROM discord.events_v1
WHERE type = 'PRESENCE_UPDATE'
  AND __ingest_ts >= ${this.literal(ingestFrom)}
  AND received_at >= ${this.literal(args.from.toISOString())}
  AND received_at < ${this.literal(args.to.toISOString())}
  AND user_id IS NOT NULL
  AND ${status} IN (${presenceStatuses.map((known) => this.literal(known)).join(", ")})
  ${this.afterCondition({ status, after: args.after })}
QUALIFY seq IS NULL OR ROW_NUMBER() OVER (PARTITION BY session_id, seq ORDER BY received_at) = 1
ORDER BY received_at, user_id, status, session_id, COALESCE(seq, -1)
LIMIT ${pageSize}`;
  }

  /**
   * 前のページの最後の行より、ORDER BY の並びで後ろにある行だけを残す条件を作る。最初のページは条件を付けない。
   */
  private afterCondition(args: { status: string; after: PresenceUpdate | undefined }) {
    if (args.after === undefined) {
      return "";
    }
    const keys = [
      ["received_at", this.literal(args.after.receivedAt.toISOString())],
      ["user_id", this.literal(args.after.userId)],
      [args.status, this.literal(args.after.status)],
      ["session_id", this.literal(args.after.sessionId)],
      ["COALESCE(seq, -1)", String(args.after.seq ?? -1)],
    ];
    // (a, b, …) > (x, y, …) を、a > x OR (a = x AND b > y) OR … に開く。
    const later = keys.map(([key], index) =>
      [
        ...keys.slice(0, index).map(([equalKey, value]) => `${equalKey} = ${value}`),
        `${key} > ${keys[index]?.[1]}`,
      ].join(" AND "),
    );
    return `AND ((${later.join(") OR (")}))`;
  }

  /**
   * 文字列を SQL の文字列 literal にする。Basin SQL の REST API は bind 変数を受け付けない。
   */
  private literal(value: string) {
    return `'${value.replaceAll("'", "''")}'`;
  }

  /**
   * 成功の応答の本文から行を PresenceUpdate の配列に読む。形が違えば throw する。
   */
  private presenceUpdates(body: unknown) {
    const rows = this.field({ value: this.field({ value: body, key: "result" }), key: "rows" });

    if (this.field({ value: body, key: "success" }) !== true || !Array.isArray(rows)) {
      throw new Error("The body is not a successful query result");
    }
    return rows.map((row: unknown) => this.presenceUpdate(row));
  }

  /**
   * 1 行を PresenceUpdate に読む。列が欠けているか型が違えば throw する。
   */
  private presenceUpdate(row: unknown): PresenceUpdate {
    const userId = this.field({ value: row, key: "user_id" });
    const receivedAt = Date.parse(String(this.field({ value: row, key: "received_at" })));
    const status = presenceStatuses.find(
      (known) => known === this.field({ value: row, key: "status" }),
    );
    const sessionId = this.field({ value: row, key: "session_id" });
    const seq = this.field({ value: row, key: "seq" }) ?? null;

    if (
      typeof userId !== "string" ||
      Number.isNaN(receivedAt) ||
      status === undefined ||
      typeof sessionId !== "string" ||
      (seq !== null && typeof seq !== "number")
    ) {
      throw new Error(`The row ${JSON.stringify(row)} cannot be read as a presence update`);
    }
    return { userId, receivedAt: new Date(receivedAt), status, sessionId, seq };
  }

  /**
   * Object の key の値を返す。object でなければ undefined を返す。
   */
  private field(args: { value: unknown; key: string }): unknown {
    if (typeof args.value !== "object" || args.value === null) {
      return undefined;
    }
    return Reflect.get(args.value, args.key);
  }
}
