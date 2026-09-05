# migiwa rebuild — 設計

- 日付: 2026-09-03
- 位置づけ: `docs/specs/2026-08-26-migiwa-design.md`(旧 spec)を置き換える。旧 spec で決めた
  目的と v1 の範囲はそのまま、既存コードは全部捨てて新しい spec と plan から作り直す。
- 範囲: v1(単一 bot、self-host / dogfood)。hosted のマルチテナント版(v2)は v1 が妨げない
  ことだけ確認する。

## 1. 目的

`roppoh/cmd/discord-gateway-proxy`(自前 k3s 上の Go プロセス → Cloudflare Pipelines → R2 Data
Catalog → R2 SQL)を置き換える。動機は 3 つ: R2 SQL は集計に約 15 秒かかり対話的な製品には
遅すぎる、protobuf でのスキーマ共有がワイヤに流れないのに存在している、デプロイが何一つ
Cloudflare ネイティブでない(k3s / ArgoCD / 自前レジストリ / sops / Grafana)。

migiwa がやること:

- Discord Gateway の `PRESENCE_UPDATE` / `VOICE_STATE_UPDATE` を Cloudflare Workers と Durable
  Object だけで取り込む。Cloudflare の外にあるのは Discord の Gateway だけ。
- 取り込み時にセッション化して DO の SQLite に保存し、presence / activity / voice に関する分析的な
  質問に 1 秒未満で答える。
- 消費経路は MCP の `query(sql)` ツール 1 本(read-only)。
- TypeScript 単一言語、スキーマの所有者は 1 か所。
- OSS(AGPL-3.0)として公開でき、`wrangler deploy` で self-host できる。
- まず作者自身のサーバーで roppoh のパイプラインを置き換え(dogfood)、その後 bot 開発者が自分の
  bot token を持ち込む hosted サービス(v2)へ育てる。

製品モデル(旧 spec から継承、変更なし): 開発者向けインフラ、BYO bot token。テナントは Discord
application(bot)であって guild ではない。特権 intent の審査と閾値は顧客の application に付く。

## 2. スコープ

### v1 に含むもの

- `migiwa-bot` Worker: Gateway 接続 1 本(IDENTIFY / RESUME / heartbeat / 再接続)、
  セッション化、SQLite 保存、保持期間 purge を担う `BotObject` DO と、DO を接続状態に保つ cron。
- `migiwa-remote-mcp` Worker: `POST /mcp`(Streamable HTTP MCP、ツール `query`)と `GET /health`。
- Drizzle スキーマと migration、`sqlite_master` から生成するツール description。
- AGENTS.md のツールチェーン一式(bun / mise / TypeScript 7 + ttsc / typia / oxlint / oxfmt / knip /
  lefthook / renovate / vite-plus / wrangler / vitest)による monorepo と CI。
- 実 Gateway に 24 時間繋ぎ続ける PoC。

### v1 に含まないもの(明示)

マルチテナント制御プレーン、サインイン、API key、課金、管理画面、REST データエンドポイント、
Webhook、R2 へのコールドアーカイブ、sharding(guild 数 2,500 以上の bot)、rate limit、claude.ai
Web コネクタ向け OAuth、メッセージ本文の保存、presence / voice 以外の Gateway イベントの取り込み、
Containers、Queues、Pipelines、R2 Data Catalog、protobuf。

### v2(hosted)の概略

D1 の制御プレーン、Discord OAuth サインイン、暗号化した token 保存、bot user id をキーにした
`BotObject`、bot 単位の API key、rate limit。v1 の形はそのために何も変えない: DO は名前でキーされ、
全行が `guild_id` を持ち、read-only の SQL 実行器が唯一のデータ経路になっている。

### 既存コードの扱い

- main(`bdaacfd`)の `apps/*`、`packages/*`、`.github/workflows/drizzle-ci.yml`、`docs/specs/*`、
  `docs/plans/*` は wave 1 で削除し、この spec と plan に従って作り直す。流用しない。
  `.github/workflows/ci.yml` と `.github/actions/**`、root のツールチェーン設定は残し、wave 1 で
  workspace 前提の行を外してから wave ごとに戻す。
- ローカルの未マージ branch(`feat/prA2-remote-mcp-health`、`feat/pr02-gateway-protocol`)は
  参照しない。削除は作者の判断に任せる。
- spec と plan は `docs/superpowers/specs/`、`docs/superpowers/plans/` に置き、両方 git で追跡する。
  AGENTS.md の `docs/specs/` / `docs/plans/` の記述はそれに合わせて直す。

## 3. 主要な決定

| # | 決定 | 旧 spec からの変更 |
|---|---|---|
| D1 | **Gateway クライアントは SQLite-backed Durable Object(`BotObject`、bot ごとに 1 つ)の中で TypeScript で動かす。** v1 のインスタンスは `idFromName("default")` の 1 つ。Cloudflare Containers で Go バイナリを動かす案は、DO の outbound WebSocket が信頼できないと分かった場合のフォールバックとして残す。 | なし |
| D2 | **保存先は同じ DO の SQLite**(bot ごとに 1 データベース)。Turso / D1 / Analytics Engine / R2 SQL / Hyperdrive は旧 spec の理由で採らない。 | なし |
| D3 | **取り込み時にセッション化する。** `presence_sessions` / `activity_sessions` / `voice_sessions` を保存し、生イベントは短期保持のみ。クエリ時にウィンドウ関数でセッションを組み立てるのが roppoh を遅くした原因。 | なし |
| D4 | **スキーマとクエリは Drizzle ORM**(`drizzle-orm/durable-sqlite`)。migration は `drizzle-kit generate`、各 DO が起動時に自分へ適用、CI で drift 検査。アプリ側のクエリも生 SQL ではなく Drizzle のクエリビルダーで書く。例外はユーザー SQL の実行(§7.3)と `sqlite_master` の参照だけで、これらは `ctx.storage.sql.exec()` を直接使う。 | クエリビルダーの使用を明示 |
| D5 | **Worker 2 つ、DO クラス 1 つ。** `migiwa-bot` が `BotObject` を定義し、`migiwa-remote-mcp` が `script_name` で bind する。MCP 側の deploy で Gateway 接続を切らないため。 | なし |
| D6 | **設定は環境変数と secret のみ**、制御プレーンなし。v1 の運用者は 1 人。 | なし |
| D7 | **MCP ツールは `query(sql)` 1 本、read-only。** REST のデータ API は無し。 | なし |
| D8 | **取り込むイベントは `PRESENCE_UPDATE` と `VOICE_STATE_UPDATE` に固定。** intents は `GUILDS \| GUILD_VOICE_STATES \| GUILD_PRESENCES` 固定。 | 旧 D8 の `EVENT_ALLOWLIST` 環境変数と intents 導出を廃止。別イベントが要る時に環境変数化する |
| D9 | **ライセンスはリポジトリ全体 AGPL-3.0。** | なし |
| D10 | **コード・コメント・README・commit・PR は英語。spec と plan は日本語。** | 置き場所が `docs/superpowers/` に変わる(§2) |
| D11 | **生イベントの `events` テーブルは残す**(7 日保持)。用途はセッション化のデバッグと、セッション行に落とさなかったフィールドの `json_extract` 参照。 | 旧 D3 の一部を明示 |
| D12 | **失敗しうる関数は `better-result` の `Result` を返す。** エラーは `TaggedError` で `_tag` を持ち(`MalformedFrame`、`NotReadOnlySql`、`GatewayBotFailed`、`ShardingRequired`、`IdentifyBudgetExhausted`、`UpgradeFailed`、`MalformedDispatch`)、複数手順の合成は `Result.gen`、分岐は `match` で網羅する。`throw` はバグ(到達しないはずの状態)にだけ使う。DO の RPC と MCP のツール応答は structured clone なので `Result` のインスタンスを運べない。その境界(`BotObject.query()` など)で `match` して plain な値に落とすか `throw` に戻す。 | 新規(2026-09-04)。依存ゼロの 3.x |
| D13 | **Gateway と REST の payload は typia で実行時検証する。** 検証する型は discord-api-types の型から `Pick` / 交差で組んだ「bot が読むフィールドだけ」のスライス型(`HelloSlice`、`ReadySlice`、`PresenceSlice`、`VoiceStateSlice`、`GuildCreateSlice`、`GuildDeleteSlice`、`GatewayBotSlice`)。`GatewayPresenceUpdateDispatchData` のような型を丸ごと検証すると、Discord の wire が型パッケージと少しでも違った時にイベントを丸ごと捨てるため。封筒(`op` / `s` / `t`)は手書きのまま。typia 14 は `ttsc`(typescript-go ベースのコンパイラ)のプラグインとしてしか動かず事前生成モードが無いので、型検査は `ttsc --noEmit`、`bun test` は `@ttsc/unplugin/bun` の preload、vitest は `@ttsc/unplugin/vite`、Worker は `wrangler.jsonc` の `build.command` で `@ttsc/unplugin/esbuild` を通した JS を `main` に渡す。 | 新規(2026-09-04、user 判断)。worker と root の推奨は「入れない」だったが、検証を型から生成する価値を優先した |

## 4. アーキテクチャ

```
Discord Gateway (wss://gateway.discord.gg/?v=10&encoding=json)
        ▲ outbound WebSocket 1 本(1 shard)
        │
┌───────┴──────────────────────────────────────────────┐   Worker: migiwa-bot
│ BotObject  (Durable Object, SQLite-backed)            │   apps/bot
│   gateway client: IDENTIFY / RESUME / heartbeat       │
│   guild フィルタ → sessionize → SQLite(同期)          │
│   KV storage: gateway 状態 (session_id, seq, …)       │
│   alarm: heartbeat ∪ reconnect backoff ∪ 日次 purge   │
│   RPC: ensureConnected(), status(), schema(), query() │
│   HTTP: GET /health(生存確認のみ、常に 200)           │
└───────┬──────────────────────────────────────────────┘
        │ cron "* * * * *" → ensureConnected()   (外形 watchdog)
        │
        │ DO binding, script_name = "migiwa-bot"
┌───────┴──────────────────────────────────────────────┐   Worker: migiwa-remote-mcp
│ Hono                                                  │   apps/remote-mcp
│   POST /mcp     Bearer API_TOKEN → MCP ツール `query`  │
│   GET  /health  connected なら 200、それ以外 503        │
└──────────────────────────────────────────────────────┘
```

- DO インスタンスはちょうど 1 つ、`idFromName("default")`。`locationHint` は指定しない。
- bot Worker の HTTP ルートは `GET /health` だけ。それ以外の入口は cron trigger と DO の RPC。

### 「接続は常時、プロセスは常時ではない」

Durable Object は `migiwa-bot` の deploy、ランタイム更新(予告なし、日 1〜2 回)、そして
incoming のリクエストやイベントが 70〜140 秒無いときに退避・再起動される。outbound 接続が DO を
alive に保つのは接続ごとに最大 15 分。hibernation は outbound ソケットには効かない。そのため
「プロセスは 1 日に数回死ぬ」前提で再接続を安くする: 状態は全部ストレージに置き、heartbeat の
alarm を keep-alive に兼用し(41.25 秒 < 70 秒)、alarm チェーンが途切れた場合は cron が DO を
起こす。Discord から見れば 1 日数回・数秒の空白を挟んで繋がっている状態で、roppoh の discordgo
が毎日やっていた「session invalidate → resume」と同じ。

## 5. Gateway クライアント(`BotObject`)

### 5.1 状態

DO の KV storage(`ctx.storage.kv`、同期 API)に置く。ユーザーの SQL から読めないよう、
意図的に SQL のテーブルには置かない:

`session_id`, `seq`, `resume_gateway_url`, `status`(`connecting | connected | resuming | backoff
| fatal | stopped`), `status_reason`, `status_since`, `backoff_until`, `backoff_attempt`,
`identify_remaining`, `identify_reset_at`, `last_ack_at`, `last_heartbeat_at`, `last_event_at`,
`disconnected_at`, `bot_user_id`, `reconnects`(直近 24 時間のカウンタ)。

`seq` はそのイベントの保存と同じ `transactionSync` の中で書く(§6.4)。再起動後は最後にコミット
したイベントの直後から RESUME でき、同じイベントを 2 回適用しない。

### 5.2 `ensureConnected()`

cron が毎分呼ぶ。ソケットが open で最終 heartbeat ACK が heartbeat 2 周期以内なら、または
`backoff_until` が未来なら no-op。それ以外は `connect()` を実行する。RPC 名を `connect` にしない
のは DO stub の `Fetcher.connect` と衝突するため。

### 5.3 `connect()`(唯一の async 経路)

1. `session_id` と `resume_gateway_url` があれば `${resume_gateway_url}?v=10&encoding=json` に
   WebSocket を開き `RESUME { token, session_id, seq }` を送る。
2. 無ければ `GET /gateway/bot`。
   - `shards > 1` → `status = fatal("sharding_required")`。
   - `session_start_limit.remaining < 50` → `reset_after` まで待つ(`backoff`)。
   - `${url}?v=10&encoding=json` を開き、HELLO を待って `IDENTIFY` を送る。intents は
     `GUILDS | GUILD_VOICE_STATES | GUILD_PRESENCES` 固定(D8)。
3. ソケットは `fetch(url, { headers: { Upgrade: "websocket" } })` と `response.webSocket.accept()`
   で開く。`new WebSocket()` は Workers ランタイムが `permessage-deflate` を自動で付けるので
   避ける。転送圧縮(`zlib-stream` / `zstd-stream`)は要求しない。
4. 1〜3 は `Result.gen` の 1 本の railway で書く(D12)。失敗は `GatewayBotFailed { status }`
   (401 なら fatal、それ以外はバックオフ)、`ShardingRequired`(fatal)、
   `IdentifyBudgetExhausted { reset_after }`(その時刻まで待つ)、`UpgradeFailed`(バックオフ)の
   4 つの `TaggedError` で、`match` が §5.7 の処理に振り分ける。

### 5.4 受信経路(同期)

`message` イベントのハンドラは**同期関数**にする。中身は
`JSON.parse → 封筒ガード → t で分岐 → reduce(純関数)→ transactionSync` で、すべて同期 API
(`ctx.storage.kv`、`ctx.storage.sql`、`ctx.storage.transactionSync`、Drizzle の `.run()` /
`.all()`)だけを使う。ハンドラが同期なら JS のイベントループが到着順の処理を保証するので、
promise chain も再入ガードも持たない。async が残るのは `connect()` だけ。

- **封筒ガード**: `op` が数値、`s` が数値か `null`、`t` が文字列か `null` であることだけを
  手書きの型ガードで確かめ、`Result<GatewayReceivePayload, MalformedFrame>` を返す(D12)。
  `MalformedFrame.reason` が捨てた理由として件数ログに残る。`d` はこの段では見ない。
- **`d` の検証(D13)**: `t` で分岐したあと、`packages/gateway` の `validateDispatch()` が typia で
  `d` をスライス型に対して検証し、`Result<ValidatedDispatch, MalformedDispatch>` を返す。HELLO の
  `d` は `validateHello()`、`GET /gateway/bot` の応答は `validateGatewayBotInfo()`。不合格なら typia
  が返す `path`(例 `$input.user.id`)を理由として件数ログに数え、そのイベントは捨てる(`seq` は
  進める)。合格した `d` はそのまま `events.payload` に保存する(typia は余分なフィールドを削らない)。
  READY / RESUMED / GUILD_CREATE / GUILD_DELETE / PRESENCE_UPDATE / VOICE_STATE_UPDATE 以外の `t` は
  検証せず `seq` だけ進める。
- **例外**: ハンドラ全体を `try/catch` で包む。失敗は件数に数えてログに出し、ソケットは閉じない。
- payload 型(`GatewayReceivePayload` の `t` による discriminated union、`GatewayIdentify` /
  `GatewayResume` / `GatewayHeartbeat`)は `discord-api-types/v10` から `import type` で取る。
  値(`GatewayOpcodes`、`GatewayCloseCodes`、`GatewayIntentBits`、`GatewayDispatchEvents`)は
  `packages/gateway` だけが `discord-api-types/gateway/v10` サブパスから import し、apps は
  `@migiwa/gateway` の再エクスポートを使う。top-level の `v10` barrel からの値 import は
  `@cloudflare/vitest-plugin` の CJS interop で `undefined` になる(wave 4 で実測。機構は
  `.claude/rules/rebuild.md`)。手書きするのは封筒ガード、close code の分類、backoff、heartbeat
  状態機械だけ。

### 5.5 heartbeat と alarm

DO の `alarm()` ハンドラは 1 つで、3 つの期限をメモリに持つ(再起動時は KV から復元):
`nextHeartbeatAt`, `nextReconnectAt`, `nextPurgeAt`。alarm は常にその最小値に整数のタイムスタンプ
でセットする。

- HELLO 受信後、初回 heartbeat は `heartbeat_interval × random()` 後、以後 `heartbeat_interval`
  ごと。heartbeat は `setInterval` ではなく alarm から送る。タイマーは退避を防がないが alarm は防ぐ。
- heartbeat の期限が来たのに前回の ACK が無ければゾンビ接続とみなし、1000 以外の code で close
  して RESUME で再接続する。
- `alarm()` は `try/catch` で包み、失敗したら 30 秒後の fallback alarm を積む。
- purge(§6.5)は同じ alarm から 1 日 1 回走る。

### 5.6 dispatch の分類

`op 0` はすべて `seq` を更新する。イベントは 2 階層:

- **内部イベント**: `READY`(`session_id`, `resume_gateway_url`, `bot_user_id` を保存)、
  `RESUMED`、`GUILD_CREATE`、`GUILD_DELETE`。
- **取り込み対象**: `PRESENCE_UPDATE`、`VOICE_STATE_UPDATE` のうち `guild_id` が guild フィルタ
  (`DISCORD_GUILD_IDS`)を通るもの。それ以外の `t` は `seq` の更新だけして捨てる。

生 payload はログに出さない。出すのはイベント種別ごとの件数だけ。

### 5.7 切断時の分岐

| 事象 | 処理 |
|---|---|
| `op 7` Reconnect | 即 close、RESUME |
| `op 9` Invalid Session, `d = true` | 1〜5 秒後に RESUME |
| `op 9`, `d = false`; close 4003, 4007, 4009 | セッション状態を破棄、1〜5 秒後に IDENTIFY |
| close 4004, 4010, 4011, 4012, 4013, 4014(token 無効、intent 未許可、shard 設定不正) | `status = fatal(reason)`。再試行は 1 時間に 1 回まで |
| その他の close、ソケットエラー、heartbeat ACK 欠落 | 指数バックオフ `1 s × 2^n`(上限 5 分、jitter 付き)の後 RESUME |

`identify_remaining` / `identify_reset_at` は `GET /gateway/bot` のたびに更新し、IDENTIFY の
たびに減らす。1 日の上限は 1,000。

### 5.8 `status()`

`{ state, since, reason, last_event_at, seq, guild_count, reconnects_24h, identify_remaining }`
を返す。remote-mcp の `/health` が使う。

## 6. データモデルとセッション化

### 6.1 原則

- 開いているセッションは `ended_at IS NULL` の行。別の「現在状態」テーブルは持たない。
  `(guild_id, user_id) WHERE ended_at IS NULL`(activity は
  `(guild_id, user_id, activity_type, activity_key)`)の部分ユニークインデックスで、1 対象につき
  open セッション 1 つを強制し、検索を O(log n) にする。
- 時刻はすべて整数の Unix ミリ秒。`received_at` は処理時点の DO の時計。
- presence は Discord が配信するとおり **guild ごと**に保存する: 3 guild で共有される user は 3 行
  になる。guild 横断の問いは消費側が `DISTINCT user_id` で処理する。
- 全テーブルが `guild_id` を持ち、突き合わせも guild 単位なので、将来 guild ごとの保存 shard に
  分割するのは機械的にできる。

### 6.2 テーブル(`packages/db` の Drizzle スキーマ)

| テーブル | 役割 | 列 |
|---|---|---|
| `guilds` | bot が見えている guild | `guild_id` PK, `name`, `member_count`, `large`, `available`, `first_seen_at`, `last_snapshot_at` |
| `events` | 生イベント、短期保持 | `id` PK, `received_at`, `seq`, `type`, `guild_id`, `user_id`(nullable), `payload`(JSON text)。索引 `(guild_id, received_at)`, `(type, received_at)` |
| `presence_sessions` | 1 つの `status` が続いた区間 | `id`, `guild_id`, `user_id`, `status`(`online`/`idle`/`dnd`), `client_desktop`, `client_mobile`, `client_web`(nullable text), `started_at`, `ended_at`, `end_reason` |
| `activity_sessions` | 1 つの activity が続いた区間 | `id`, `guild_id`, `user_id`, `activity_type`(0–5), `activity_key`, `application_id`, `name`, `state`, `details`, `started_at`, `ended_at`, `end_reason` |
| `voice_sessions` | **1 つのチャンネル**に居続けた区間 | `id`, `guild_id`, `user_id`, `channel_id`, `discord_session_id`, `started_at`, `ended_at`, `end_reason`, `self_mute`, `self_deaf`, `mute`, `deaf`, `self_stream`, `self_video`, `suppress`(フラグは最後に観測した値) |

`activity_key` は `application_id` があればそれ、無ければ `name`。Discord は activity の `id` を
unstable としているので同一性には使わない。`end_reason` の値: `status_change`, `offline`,
`activity_end`, `leave`, `move`, `snapshot_missing`, `guild_removed`, `timeout`。

`GUILD_CREATE` の payload は `{ id, name, member_count, large, presences_count,
voice_states_count }` に刈り込んで保存する。`PRESENCE_UPDATE` / `VOICE_STATE_UPDATE` は `d` を
そのまま保存する。

意図的に捨てるもの: activity の `assets` / `party` / `secrets` / `buttons`(`events.payload` に
7 日残る)、voice フラグの変更履歴、`client_status.vr`。

Drizzle の書き方: 列の TS プロパティ名 = DB 列名(snake_case)、`casing` オプションは使わない。
boolean は `integer({ mode: "boolean" })`、JSON は `text({ mode: "json" })`。1 ファイル 1 テーブル。

### 6.3 規則

セッション化は `packages/sessionizer` の純関数 `reduce(openRows, event, now) → ops`。`apps/bot`
が ops を Drizzle のクエリビルダーで適用する。以下の各規則がそのままテストケースになる。

| イベント | 規則 |
|---|---|
| `PRESENCE_UPDATE` | **status:** open 行の `status` が同じなら何もしない。違えば close(`status_change`、新 status が `offline` なら `offline`)し、新 status が `offline` でなければ新しい行を open。**activities:** payload の `(type, activity_key)` の集合を作り、集合に無い open 行を close(`activity_end`)、open 行が無いキーを open(`started_at` は Discord の `created_at` があればそれ、無ければ `received_at`)、両方にあるキーは `state` / `details` を更新。`offline` は activity 行も全部 close する。 |
| `VOICE_STATE_UPDATE` | open 行なし ∧ `channel_id ≠ null` → open。open 行あり ∧ `channel_id = null` → close(`leave`)。open 行あり ∧ `channel_id` が違う → close(`move`)して open。同じチャンネル → フラグ更新のみ。 |
| `GUILD_CREATE` | `guilds` を upsert。`presences[]` と `voice_states[]` を上の 2 規則で適用。その後**突き合わせ**: この guild の open 行のうち、スナップショットに居ない user を close(`snapshot_missing`、`ended_at` は `disconnected_at` があればそれ、無ければ `received_at`)。`member_count > 75,000` の guild は Discord が `presences` を刈り込むため、presence の突き合わせをスキップする。 |
| `GUILD_DELETE` | `unavailable = true`(障害): `guilds.available = 0` にし、セッションは開けたまま。それ以外(bot が外された): この guild の open 行を全部 close(`guild_removed`)し、guild を unavailable にする。 |
| `READY` / `RESUMED` | gateway 状態のみ更新。RESUME 成功後は replay されたイベントが通常の規則を通る。新規 IDENTIFY 後は `GUILD_CREATE` のスナップショットが補正を行う。 |

guild フィルタ: `DISCORD_GUILD_IDS` が設定されていれば、それ以外の guild のイベントは reduce の
前に捨て、その guild は追跡しない。

### 6.4 原子性と冪等性

dispatch 1 件につき、生 `events` の insert、セッションの ops、`seq` の書き込み(`ctx.storage.kv.put`)
を 1 つの `ctx.storage.transactionSync(...)` で行う。同期 KV API が `transactionSync` の中で使えないと
分かった場合は `seq` だけを 1 行の SQL テーブルに移す(`seq` は機微ではない。`session_id` は KV に
残す)。Drizzle の `db.transaction()` に async コールバックを渡さない(drizzle-orm #4322)。規則は open 行との状態比較なので同じイベントの再適用は
no-op であり、正確な `seq` と合わせて RESUME で二重計上は起きない。

### 6.5 保持期間(日次 alarm)

- `RAW_EVENT_RETENTION_DAYS`(既定 7)より古い `events` を削除。
- `ended_at` が `RETENTION_DAYS`(既定 30)より古い閉じたセッションを削除。
- 7 日以上開いているセッションは `timeout` で強制 close(安全弁)。

想定量(1,000 人 guild): 約 1,500 セッション/日、30 日で約 4.5 万行。DO あたり 10 GB の上限は
v1 の規模では無関係。

### 6.6 Drizzle と migration

- `drizzle-orm` / `drizzle-kit` は stable の最新(`@rc` は使わない)。ドライバは `durable-sqlite`、
  `drizzle(ctx.storage, { schema })`。
- `packages/db/drizzle.config.ts` に `driver: "durable-sqlite"`、出力は `packages/db/drizzle/`、
  生成物は `linguist-generated=true`。migration は `bun run generate:migration` で手動生成し、CI で
  `drizzle-kit generate` が差分を生まないこと(drift)と、生成済み `.sql` がインメモリ SQLite に
  適用できること(migrate)を検査する。
- `BotObject` の constructor で `ctx.blockConcurrencyWhile(() => migrate(db, migrations))`。
  `__drizzle_migrations` が冪等にする。
- `migrations.js` は `.sql` を import するので、`wrangler.jsonc` に
  `rules: [{ type: "Text", globs: ["**/*.sql"], fallthrough: true }]` が要る。
- migration の検証は素の `wrangler dev` で行い、`@cloudflare/vite-plugin` 経由にしない
  (drizzle-orm #4558)。Drizzle Studio と `drizzle-kit push` は DO 非対応。

## 7. MCP Worker(`migiwa-remote-mcp`)

### 7.1 認証

`/health` 以外の全ルートは `Authorization: Bearer <API_TOKEN>` 必須、定数時間比較。無い・違う →
401。v1 は token 1 本で rate limit なし。

### 7.2 `POST /mcp`

`@modelcontextprotocol/sdk` の `McpServer` + `@hono/mcp` の `StreamableHTTPTransport` を stateless
モード(`sessionIdGenerator: undefined`)でリクエストごとに生成する。CORS は
`mcp-protocol-version` と `mcp-session-id` ヘッダを許可する。

ツールはちょうど 1 つ、`query({ sql })`。`listTools()` が `["query"]` を返すことをテストで固定し、
定型メトリクスのツールが増えないようにする。設計の要点は「LLM が親切なテーブルに対して SQL を
書く」ことにある。

ツールの description は `packages/mcp` の純関数 `buildDescription(tables)` で生成する。`tables`
は DO の `schema()` RPC が `sqlite_master` から返す(`sqlite_%`, `__drizzle_%`, `_cf_%` を prefix で
除外)。description が全テーブル・全列に触れていることをテストで確認する。description に含める
内容: テーブルの意味と `end_reason` の値、時刻は Unix ms(`datetime(started_at / 1000, 'unixepoch')`)、
open セッションは `ended_at IS NULL`、滞在時間は
`COALESCE(ended_at, unixepoch() * 1000) - started_at`、`events.payload` は JSON(`json_extract`)、
presence 行は guild ごとに重複する、必ず `LIMIT` を付ける。

### 7.3 read-only の担保(`BotObject.query(sql)`)

- **第 1 層(純関数)**: `packages/db` の `ensureReadOnly(sql): Result<string, NotReadOnlySql>`(D12)。
  コメントと空白を除いた先頭が `SELECT` / `WITH` / `EXPLAIN` のいずれかであること。2 文目(`;` の
  後に何かある)は拒否。`PRAGMA` / `ATTACH` と、書き込み動詞(`INSERT` / `UPDATE` / `DELETE` /
  `REPLACE` / `DROP` / `ALTER` / `CREATE` / `VACUUM` / `DETACH` / `REINDEX` / `SAVEPOINT` / `RELEASE`)を
  識別子境界付きで文全体から拒否する。`WITH` は SQLite の `insert-stmt` / `update-stmt` /
  `delete-stmt` の先頭にも置けるので、先頭キーワードだけでは read-only を保証しない
  (2026-09-05 のセキュリティレビューで `WITH x AS (SELECT 1) DELETE FROM guilds` が旧ガードを通り
  実際に全行を消すことを実測)。`EXPLAIN` は VDBE プログラムを返すだけで実行しないので安全。
- **第 2 層(構造的)**: `BotObject.query()` は第 1 層を通った文を `ctx.storage.transactionSync` の中で
  実行してカーソルを読み切り、`cursor.rowsWritten > 0` なら throw してロールバックする。正規表現の
  完全性に依存せず、書き込みは構造的に残らない。`SqlStorage` には read-only モードも authorizer も
  無く、`PRAGMA query_only` は第 1 層が禁止しているので、DO で使える強制層はこの 2 つだけ。
- `query()` は RPC 境界なので `Err` と throw を `Error` として返し、MCP ツール側が `isError` の応答にする。
- 行は `ctx.storage.sql.exec()` のカーソルから読み、10,000 行で打ち切る。応答は
  `{ columns, rows, rows_read, truncated }`。
- 実行時間の上限は DO の CPU 制限のみ。
- gateway 状態は SQL ではなく KV にあるので、ここから `session_id` には届かない。

### 7.4 `GET /health`

- `migiwa-bot` の `/health`: 認証なし、`BotObject` に触らず常に `200 { "message": "ok" }`
  (Worker の生存確認のみ)。
- `migiwa-remote-mcp` の `/health`: 認証なし。body は `status()` の `StatusReport` そのもの。
  `state === "connected"` なら 200、それ以外は 503。外形監視に登録することを
  想定した、cron に次ぐ「人間向け」の安全網。

## 8. 設定

| Worker | 名前 | 種別 | 既定値 | 意味 |
|---|---|---|---|---|
| bot | `DISCORD_BOT_TOKEN` | secret | 必須 | bot token。`wrangler.jsonc` の `secrets.required` に宣言 |
| bot | `DISCORD_GUILD_IDS` | var | 空 = 全 guild | 保持する guild id のカンマ区切り |
| bot | `RAW_EVENT_RETENTION_DAYS` | var | `7` | `events` の保持日数 |
| bot | `RETENTION_DAYS` | var | `30` | 閉じたセッションの保持日数 |
| remote-mcp | `API_TOKEN` | secret | 必須 | `/mcp` の bearer token |
| remote-mcp | `BOT` | DO binding | — | `class_name: BotObject`, `script_name: migiwa-bot` |

secret は Secrets Store ではなく通常の Worker secret(`wrangler secret put`)。self-host 手順:
Discord Developer Portal で bot の Presence Intent(`GUILD_PRESENCES` は特権 intent)を有効にする、
`wrangler secret put` × 2、`wrangler deploy` × 2、MCP クライアントに `https://<remote-mcp>/mcp` と
bearer token を設定する。

## 9. エラー処理と観測

- dispatch 1 件の処理中の例外はログに出して次へ進む。アプリケーションエラーでソケットを閉じる
  ことはしない。予期できる失敗(封筒が壊れている、必須 id が無い、接続手順の各段)は例外ではなく
  `Result` の `Err`(D12)で、`_tag` と理由が件数ログに乗る。`try/catch` が残るのはバグを
  握るためだけ。
- `alarm()` の失敗は 30 秒後の fallback alarm を積む(§5.5)。`connect()` の失敗はバックオフへ
  (§5.7)。
- ログは Workers Logs(`wrangler.jsonc` の `observability.enabled`)に JSON 1 行ずつ: 接続イベント(identify /
  resume / close code / fatal 理由)、種別ごとの ingest 件数と捨てた件数、purge 件数。payload は
  決して出さない。メトリクス基盤は作らない。

## 10. テスト

1. **`bun test`(純粋ロジック、`packages/*`)**: セッション化の規則(§6.3 の表そのまま)、封筒
   ガード、typia の検証器(スライス型ごとの合格 / 不合格と失敗時の `path`)、close code の分類とバックオフ、heartbeat 状態機械、read-only SQL ガード、
   `buildDescription`。
2. **`@cloudflare/vitest-plugin`(`apps/*`、実 workerd)**: モック Discord(plain JS の auxiliary
   worker。`GET /gateway/bot` と Gateway の WebSocket を偽装し、Miniflare の `outboundService` で
   bot の全 outbound `fetch` を受ける)に対する `BotObject`(HELLO → IDENTIFY → READY → dispatch →
   op 7 → RESUME)、eviction 後に保存済み `seq` で RESUME が成功すること、新規 DO への migration 適用
   と 2 回目が no-op であること、`InMemoryTransport` 経由の MCP(`listTools()` が `["query"]`)、
   bot の `/health` が常に 200、remote-mcp の `/health` の 200/503、`sqlite_master` と description
   のズレ検査。vitest の config は deploy と同じ `wrangler.jsonc` を指す。auxiliary worker は
   事前ビルド済み JS でなければならず wrangler config も読めないので、remote-mcp のテストは
   `script_name: "migiwa-bot"` を同じ RPC 面を持つ plain JS の偽 `BotObject` に bind する。本物との
   cross-script binding は deploy 後の `curl /health` で証明する。テスト専用の wrangler config は
   作らない。
3. **24 時間 PoC(手動)**: Gateway 接続を実装する wave の完了条件。作者のアカウントに deploy し、
   実 Gateway に 24 時間繋ぐ。合格: `connected` でない時間の合計が 10 分未満、`reconnects_24h ≤ 10`、
   `identify_remaining` が単調減少していない(RESUME が効いている)、Workers Logs に close code
   4004 / 4013 / 4014 が無い。不合格なら D1 のフォールバック(Containers)を spec に追記してから
   以降の wave を書き直す。

## 11. リポジトリ、ツールチェーン、CI、deploy

ツールチェーンと規約は AGENTS.md に従う(bun workspaces + `workspaces.catalog`、mise、
TypeScript 7 と `ttsc`(型検査と typia の変換、D13)、`@ttsc/unplugin`、oxlint / oxfmt、knip、
lefthook、renovate、vite-plus の `vp run`、wrangler、vitest)。
バージョンは AGENTS.md と `package.json` の catalog が真で、この spec には書かない。

```
migiwa/
  package.json  mise.toml  mise.lock  tsconfig.json  tsconfig.base.json  vite.config.ts
  oxlint.config.ts  oxfmt.config.ts  knip.config.ts  lefthook.yml  renovate.json  bunfig.toml
  .npmrc  .editorconfig  .gitattributes  .gitignore  AGENTS.md  CLAUDE.md  README.md
  LICENSE (AGPL-3.0)
  .github/workflows/{ci,drizzle-ci}.yml  .github/actions/{setup-mise,setup-bun,cache-vp-tasks}
  apps/bot/              migiwa-bot: entry.ts, server.ts, bot-object.ts, build.ts(ttsc 経由の esbuild), wrangler.jsonc(DO, migrations, cron, build.command)
  apps/remote-mcp/       migiwa-remote-mcp: entry.ts, server.ts, routes/{mcp,health}.ts, middlewares/, wrangler.jsonc
  packages/db/           Drizzle スキーマ(1 ファイル 1 テーブル)、drizzle.config.ts、drizzle/ migration、client、行型
  packages/gateway/      プロトコル純ロジック: 封筒ガード、typia の検証器とスライス型、close code 分類、backoff、heartbeat 状態機械、RPC 契約の型
  packages/sessionizer/  reduce(openRows, event, now) → ops
  packages/mcp/          McpServer factory、query ツール、buildDescription
  docs/superpowers/specs/  設計文書(日本語)
  docs/superpowers/plans/  実装計画(日本語)
```

`apps/*` は薄い deploy 単位、`packages/*` は `@migiwa/<name>` のソース専用パッケージ。
`packages/gateway` が bot ⇄ remote-mcp の RPC 契約(`StatusReport` 等)を持つ(apps 同士は import
できない)。

CI(GitHub-hosted runner、public リポジトリ):

| workflow | 内容 |
|---|---|
| `ci.yml` | lockfile と `mise.lock` の差分検査、oxfmt / oxlint / type-check / knip / `bun test` / vitest / `wrangler types --check` / `wrangler deploy --dry-run`(両 app) |
| `drizzle-ci.yml` | `packages/db` 変更時のみ: 生成済み `.sql` をインメモリ SQLite に適用する migrate 検査 + `drizzle-kit generate` が差分を生まない drift 検査 |

deploy は **Cloudflare Workers Builds**(ダッシュボードの GitHub 連携)が main への push で両 Worker
をビルド・deploy する。GitHub 側に Cloudflare の token は持たない。リポジトリ内で deploy 可能性を
担保するのは `ci.yml` の `wrangler deploy --dry-run` だけ。両 Worker とも dogfood 中は
`workers_dev: true` で workers.dev に公開する。

## 12. リスクと対策

| リスク | 対策 |
|---|---|
| DO は 1 日に数回再起動する。outbound の keep-alive は 15 分上限。hibernation は outbound ソケットに効かない | RESUME を正常経路として設計(§5)。alarm による keep-alive、cron の watchdog、remote-mcp の `/health` |
| 再接続ループのバグで 1 日 1,000 回の IDENTIFY 予算を使い切る | 予算を追跡し 50 回を予備として残す。fatal な code は 1 時間ごとの再試行。あらゆる場面で RESUME を優先 |
| Cloudflare の egress から Discord Gateway に繋げない(2025-12-05 まで実際にブロックされていた) | 24 時間 PoC(§10)。Containers を文書化したフォールバックとして残す(D1) |
| DO の SQLite はオブジェクトあたり 10 GB のハード上限 | セッションを保存し生イベントは 7 日保持。超えるなら `guild_id` で保存を shard する(全テーブルと全規則が guild スコープ) |
| guild 数 2,500 以上の bot は sharding が必要 | `GET /gateway/bot` の時点で `fatal("sharding_required")`。v1 のスコープ外 |
| Discord Developer Policy はユーザー間の関係性のプロファイリングを禁止 | 「誰が誰と一緒だったか」系の機能は作らない。user × guild 単位の presence / voice / activity のみ |
| Drizzle の DO ドライバが若い(#4322、#4558) | 同期トランザクションのみ、stable バージョン、migration 検証は `wrangler dev` |
| 同期の `message` ハンドラが重くなり後続イベントが遅れる | セッション化は open 行 1〜数行との比較で O(log n)。GUILD_CREATE の突き合わせだけが guild 全体を舐めるが、IDENTIFY 直後にしか来ない |
