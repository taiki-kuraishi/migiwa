import { Result } from "better-result";

import type { Game, GameUpdate, Listening, ListeningUpdate, PresenceUpdate } from "./types";

import {
  gameActivityType,
  listeningActivityType,
  pageSize,
  presenceStatuses,
  requestTimeout,
} from "./constants";
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
    return this.findAllAfter({
      after: undefined,
      queryAfter: (after: PresenceUpdate | undefined) =>
        this.presenceUpdatesQuery({ ...args, after }),
      read: (row) => this.presenceUpdate(row),
    });
  }

  /**
   * POST /basin-sql/query/{bucket} で、[from, to) に受けた PRESENCE_UPDATE を、それぞれの時点で遊んでいた
   * ゲーム（activities の type 0）とともに (受けた時刻, user) の順にすべて返す。ページは findPresenceUpdates と
   * 同じくたどって読む。
   */
  public async findGameUpdates(args: { from: Date; to: Date }) {
    return this.findAllAfter({
      after: undefined,
      queryAfter: (after: GameUpdate | undefined) => this.activityUpdatesQuery({ ...args, after }),
      read: (row) => {
        const { activities, ...update } = this.activityUpdate(row);
        return { ...update, games: this.games(activities) };
      },
    });
  }

  /**
   * POST /basin-sql/query/{bucket} で、[from, to) に受けた PRESENCE_UPDATE を、それぞれの時点で聴いていた曲
   * （activities の type 2）とともに (受けた時刻, user) の順にすべて返す。ページは findPresenceUpdates と同じく
   * たどって読む。
   */
  public async findListeningUpdates(args: { from: Date; to: Date }) {
    return this.findAllAfter({
      after: undefined,
      queryAfter: (after: ListeningUpdate | undefined) =>
        this.activityUpdatesQuery({ ...args, after }),
      read: (row) => {
        const { activities, ...update } = this.activityUpdate(row);
        return { ...update, listenings: this.listenings(activities) };
      },
    });
  }

  /**
   * After より後ろの行を、最後のページまでたどって返す。
   * 1. After より後ろの 1 ページを読む
   * 2. pageSize 件に満たなければ最後のページなので、そのまま返す
   * 3. ページの最後の行より後ろを読み、つなげて返す
   */
  // 自分を呼ぶので、戻り値の型を推論できない。
  private async findAllAfter<T>(args: {
    after: T | undefined;
    queryAfter: (after: T | undefined) => string;
    read: (row: unknown) => T;
  }): Promise<Result<T[], BasinSqlRequestError | BasinSqlResponseError>> {
    return Result.gen(async function* () {
      // Step 1: After より後ろの 1 ページを読む
      const page = yield* await this.query({ query: args.queryAfter(args.after), read: args.read });

      // Step 2: pageSize 件に満たなければ最後のページなので、そのまま返す
      if (page.length < pageSize) {
        return Result.ok(page);
      }

      // Step 3: ページの最後の行より後ろを読み、つなげて返す
      const rest = yield* await this.findAllAfter({ ...args, after: page.at(-1) });
      return Result.ok([...page, ...rest]);
    }, this);
  }

  /**
   * Query を 1 回送り、各行を read で読んだ配列を返す。
   * 1. Query を送る。届かなければ BasinSqlRequestError を返す
   * 2. 成功の応答でなければ BasinSqlResponseError を返す
   * 3. 行を read で読み、読めない行があれば BasinSqlResponseError を返す
   */
  private async query<T>(args: { query: string; read: (row: unknown) => T }) {
    return Result.gen(async function* () {
      // Step 1: Query を送る。届かなければ BasinSqlRequestError を返す
      const response = yield* await Result.tryPromise({
        try: async () =>
          fetch(this.endpoint, {
            method: "POST",
            headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
            body: JSON.stringify({ query: args.query }),
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

      // Step 3: 行を read で読み、読めない行があれば BasinSqlResponseError を返す
      return Result.try({
        try: () => this.rows(JSON.parse(text)).map((row) => args.read(row)),
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
  ${this.afterCondition(
    args.after && [
      ["received_at", this.literal(args.after.receivedAt.toISOString())],
      ["user_id", this.literal(args.after.userId)],
      [status, this.literal(args.after.status)],
      ["session_id", this.literal(args.after.sessionId)],
      ["COALESCE(seq, -1)", String(args.after.seq ?? -1)],
    ],
  )}
QUALIFY seq IS NULL OR ROW_NUMBER() OVER (PARTITION BY session_id, seq ORDER BY received_at) = 1
ORDER BY received_at, user_id, status, session_id, COALESCE(seq, -1)
LIMIT ${pageSize}`;
  }

  /**
   * [from, to) の PRESENCE_UPDATE を、payload とともに重複を除いて読む SQL を作る。
   */
  // Basin SQL には入れ子の JSON を開く関数が無く、activities を SQL で行に展開できないので、payload を丸ごと
  // 読んで Worker で開く。
  private activityUpdatesQuery(args: {
    from: Date;
    to: Date;
    after: { receivedAt: Date; userId: string; sessionId: string; seq: number | null } | undefined;
  }) {
    const ingestFrom = new Date(args.from.getTime() - 3_600_000).toISOString();
    // QUALIFY: presenceUpdatesQuery と同じく、同じ dispatch（session_id, seq）の行を 1 つにする。json の列は
    // DISTINCT で比べないが、残った重複は同じ activities なので区間を変えない。
    return `SELECT user_id, received_at, session_id, seq, payload
FROM discord.events_v1
WHERE type = 'PRESENCE_UPDATE'
  AND __ingest_ts >= ${this.literal(ingestFrom)}
  AND received_at >= ${this.literal(args.from.toISOString())}
  AND received_at < ${this.literal(args.to.toISOString())}
  AND user_id IS NOT NULL
  ${this.afterCondition(
    args.after && [
      ["received_at", this.literal(args.after.receivedAt.toISOString())],
      ["user_id", this.literal(args.after.userId)],
      ["session_id", this.literal(args.after.sessionId)],
      ["COALESCE(seq, -1)", String(args.after.seq ?? -1)],
    ],
  )}
QUALIFY seq IS NULL OR ROW_NUMBER() OVER (PARTITION BY session_id, seq ORDER BY received_at) = 1
ORDER BY received_at, user_id, session_id, COALESCE(seq, -1)
LIMIT ${pageSize}`;
  }

  /**
   * 前のページの最後の行より、ORDER BY の並び（列と、その行の値の literal）で後ろにある行だけを残す条件を作る。
   * 最初のページは条件を付けない。
   */
  private afterCondition(keys: [string, string][] | undefined) {
    if (keys === undefined) {
      return "";
    }
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
   * 成功の応答の本文から行の配列を取り出す。形が違えば throw する。
   */
  private rows(body: unknown): unknown[] {
    const rows = this.field({ value: this.field({ value: body, key: "result" }), key: "rows" });

    if (this.field({ value: body, key: "success" }) !== true || !Array.isArray(rows)) {
      throw new Error("The body is not a successful query result");
    }
    return rows;
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
   * 1 行を、受けた時刻・user・dispatch と payload の activities に読む。列が欠けているか型が違えば throw する。
   */
  private activityUpdate(row: unknown) {
    const userId = this.field({ value: row, key: "user_id" });
    const receivedAt = Date.parse(String(this.field({ value: row, key: "received_at" })));
    const sessionId = this.field({ value: row, key: "session_id" });
    const seq = this.field({ value: row, key: "seq" }) ?? null;
    const payload: unknown = this.field({ value: row, key: "payload" });
    // Payload の json の列が文字列で返るか object で返るかは Basin SQL が決めるので、どちらも受ける。
    const activities = this.field({
      value: typeof payload === "string" ? JSON.parse(payload) : payload,
      key: "activities",
    });

    if (
      typeof userId !== "string" ||
      Number.isNaN(receivedAt) ||
      typeof sessionId !== "string" ||
      (seq !== null && typeof seq !== "number") ||
      !Array.isArray(activities)
    ) {
      throw new Error(`The row ${JSON.stringify(row)} cannot be read as an activity update`);
    }
    return {
      userId,
      receivedAt: new Date(receivedAt),
      sessionId,
      seq,
      activities,
    };
  }

  /**
   * Activities のうち type 0 のものを、game_key ごとに 1 つにして返す。name の無い activity は読まない。
   */
  // 同じ application_id の activity が同じ更新に 2 つ並ぶことがあり（言語違いの名前など）、区間を 1 つにする。
  private games(activities: unknown[]) {
    const games = activities.flatMap((activity): Game[] => {
      const name = this.field({ value: activity, key: "name" });
      const applicationId = this.field({ value: activity, key: "application_id" });
      const officialGameId = this.field({ value: activity, key: "official_game_id" });

      if (
        this.field({ value: activity, key: "type" }) !== gameActivityType ||
        typeof name !== "string"
      ) {
        return [];
      }
      return [
        {
          key: typeof applicationId === "string" ? applicationId : name,
          applicationId: typeof applicationId === "string" ? applicationId : null,
          officialGameId: typeof officialGameId === "string" ? officialGameId : null,
          name,
        },
      ];
    });
    return [...Map.groupBy(games, (game) => game.key).values()].flatMap((same) => same.slice(0, 1));
  }

  /**
   * Activities のうち type 2 のものを、listening_key ごとに 1 つにして返す。name の無い activity は読まない。
   */
  private listenings(activities: unknown[]) {
    const listenings = activities.flatMap((activity): Listening[] => {
      const name = this.field({ value: activity, key: "name" });
      const syncId = this.field({ value: activity, key: "sync_id" });
      const details = this.field({ value: activity, key: "details" });
      const state = this.field({ value: activity, key: "state" });

      if (
        this.field({ value: activity, key: "type" }) !== listeningActivityType ||
        typeof name !== "string"
      ) {
        return [];
      }
      return [
        {
          key: typeof syncId === "string" ? syncId : name,
          syncId: typeof syncId === "string" ? syncId : null,
          name,
          details: typeof details === "string" ? details : null,
          state: typeof state === "string" ? state : null,
        },
      ];
    });
    return [...Map.groupBy(listenings, (listening) => listening.key).values()].flatMap((same) =>
      same.slice(0, 1),
    );
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
