# migiwa v1 — Cloudflare Durable Objects 上の Discord Gateway 取り込み基盤

- 状態: 設計承認済み、実装計画は未作成
- 日付: 2026-08-26
- 範囲: v1(単一 bot、self-host / dogfood)。hosted のマルチテナント版は v2 で、v1 がそれを妨げないことを確認するために概略だけ書く。

## 1. 背景と目的

`roppoh/cmd/discord-gateway-proxy` は自前 k3s ノード上の Go プロセスで、Discord Gateway の
WebSocket を 1 本保持し、`PRESENCE_UPDATE` / `VOICE_STATE_UPDATE` / `GUILD_CREATE` をフラットな
行に変換して Cloudflare Pipelines に POST し、R2 Data Catalog(Iceberg)のテーブルに着地させ、
MCP サーバーが R2 SQL で読む構成だった。再設計の動機は 3 つ。

1. **クエリが対話的な製品には遅すぎる。** 集計に約 15 秒かかる。原因は R2 Data Catalog の
   compaction が一度も走っていないこと(`credential_status: absent`。22,213 行が 10,000 超の
   Parquet ファイルに散在)。compaction を直しても R2 SQL はバッチエンジン(公式表現は「秒単位」)
   で、`COUNT(DISTINCT)` やウィンドウ関数をスキャン量見積りで拒否し、読み取り専用でもある。
2. **protobuf でのスキーマ共有が無理矢理。** ワイヤ上に protobuf のバイトは一度も流れない(取り込みは
   JSON)。`.proto` は自作ジェネレータの入力として Go struct / Terraform JSON / Iceberg スキーマを
   吐かせるためだけに存在し、しかも proto のフィールド番号は Iceberg のフィールド ID と 1:1 ですらない。
3. **デプロイが何一つ Cloudflare ネイティブでない。** k3s、ArgoCD、Argo Workflows、自前 OCI
   レジストリ、sops/age、Grafana LGTM。小さな OSS が抱えるべき運用面ではない。

migiwa の目的:

- Cloudflare(Workers、Durable Objects)だけで動かす。Cloudflare の外にあるのは Discord の
  Gateway そのものだけ。
- presence / activity / voice に関する分析的な質問に 1 秒未満で答える。
- TypeScript 単一言語で、スキーマの所有者が 1 か所のコードベースにする。
- OSS(AGPL-3.0)として公開でき、`wrangler deploy` で self-host できる。
- まず作者自身のサーバーで roppoh のパイプラインを置き換え(dogfood)、その後 bot 開発者が自分の
  bot token を持ち込む hosted サービスへ育てる(v2)。

製品モデル(この設計より前に決定済み): **開発者向けインフラ、BYO bot token**。テナントは
Discord application(bot)であって guild ではない。したがって特権 intent の審査、10,000 ユニーク
ユーザーの閾値、年次再申請は顧客の application に付き、運営者には付かない。Discord の Developer
Terms §12(a) は、書面合意の下で「Service Provider」が開発者の代理として token と API Data を
扱うことを明示的に許可している。

## 2. 主要な決定

| # | 決定 | 検討した代替案と却下理由 |
|---|---|---|
| D1 | **Gateway クライアントは SQLite-backed Durable Object(`BotObject`、bot ごとに 1 つ)の中で TypeScript で動かす。** | *Cloudflare Containers で既存の Go/discordgo バイナリを動かす*: 大規模時の接続単価は半分(≈ $2.05 vs ≈ $4.15/月)で書き直しもゼロだが、ランタイムが 2 つになり、取り込みの hop が増え、self-host に Docker が要る。「`wrangler deploy` だけで self-host できる」「TypeScript 一本」を優先して却下。DO の outbound WebSocket が信頼できないと分かった場合のフォールバックとして残す。 |
| D2 | **保存先は同じ DO の SQLite**(bot ごとに 1 データベース)。 | *Turso の database-per-tenant*: 10 GB の壁が無く小規模では安いが、毎クエリがネットワーク越しの HTTP 往復(非公式で 140〜250 ms)、ベンダーが 2 社目、エンジン書き換え中、2023 年にクロステナント漏洩あり。*D1*: 同じ 10 GB 上限で動的 binding 不可。*Analytics Engine*: サンプリング、保持 3 か月固定、テナント単位削除不可。*R2 Data Catalog + Pipelines + R2 SQL*: beta、account あたり 20 streams、秒単位のレイテンシ。将来のコールドアーカイブ候補としてのみ残す。*Hyperdrive + Postgres*: config 25 個/account。 |
| D3 | **取り込み時にセッション化する。** `presence_sessions` / `activity_sessions` / `voice_sessions` を保存し、生イベントは短期保持のみ。 | 生イベントを保存してクエリ時にセッションを組み立てるのが roppoh のクエリを重くした原因(隣接行のウィンドウ関数)で、LLM が書く SQL にも不親切。 |
| D4 | **スキーマは Drizzle ORM(`drizzle-orm/durable-sqlite`)が所有**し、migration は `drizzle-kit` で生成、各 DO が起動時に自分へ適用する。 | 生 SQL + 自前バージョン表は単純だが型付きクエリを失う。Kysely の DO dialect はメンテ停止(最終 push 2025-06)。 |
| D5 | **Worker 2 つ、DO クラス 1 つ。** `migiwa-bot` が `BotObject` を定義し、`migiwa-api` が MCP と health を提供して `script_name` で DO に bind する。 | Worker 1 つだと API の deploy のたびに DO が再起動し、Gateway 接続が切れる。 |
| D6 | **設定は環境変数のみ**、制御プレーンなし。bot token と任意の guild フィルタは Worker の secret / var で渡す。 | 管理画面・D1 テーブル・Discord OAuth サインインを設計した上で削除した。v1 の運用者は 1 人だけ。v2 で戻す。 |
| D7 | **MCP ツールは `query(sql)` 1 本、read-only。** REST のデータ API は無し。 | セッション単位の typed REST を設計した上で同じ理由で削除。v1 の消費者は作者の MCP クライアントだけ。REST を足すのは後から 1 ファイル。 |
| D8 | **汎用イベント取り込み + allowlist**、既定は `PRESENCE_UPDATE,VOICE_STATE_UPDATE`。 | presence/voice 固定は roppoh の調査が却下した分析 SaaS の形をハードコードすることになる。既定で全イベント取り込みは保存量とプライバシー露出が爆発する。 |
| D9 | **ライセンスはリポジトリ全体 AGPL-3.0。** | 当初の「server AGPL + connector MIT」は顧客に組み込む Go connector を前提にしており、D1 でそれが消えた。クライアント SDK を切り出す日が来たらそれは MIT。 |
| D10 | **コード・コード内コメント・README・コミットメッセージ・PR は英語。設計 spec(このディレクトリ)は日本語。** | 実装物は英語圏のコントリビューターと利用者に届く必要がある。spec は作者が設計判断を考え直すための文書なので、書きやすさと読みやすさを優先する。 |

## 3. スコープ

### v1 に含むもの

- `migiwa-bot` Worker: Gateway 接続 1 本・セッション化・SQLite 保存・保持期間 purge を担う
  `BotObject` DO と、DO を接続状態に保つ cron trigger。
- `migiwa-api` Worker: `POST /mcp`(Streamable HTTP MCP、ツール `query`)と `GET /health`。
- Drizzle スキーマと migration、`sqlite_master` から生成するツール description。
- roppoh の規約に倣った monorepo・ツールチェーン・CI。
- Task 0 PoC: DO から実 Gateway に 24 時間繋ぎ続ける。

### v1 に含まないもの(明示)

マルチテナント制御プレーン、サインイン、API key、課金、管理画面、REST データエンドポイント、
Webhook、R2 へのコールドアーカイブ、sharding(guild 数 2,500 以上の bot)、rate limit、claude.ai
Web コネクタ向け OAuth(OAuth + 動的クライアント登録が必要)、既定でのメッセージ本文の保存、
Containers、Queues、Pipelines、R2 Data Catalog、protobuf。

### v2(hosted)の概略

D1 の制御プレーン(`accounts`, `bots`, `api_keys`)、Discord OAuth サインイン(`identify`
スコープ)、AES-GCM で暗号化した token 保存、`"default"` ではなく bot user id をキーにした
`BotObject.start(botId)`、bot 単位の API key、rate limit binding、利用規約への Service Provider
条項を足す。v1 の形はそのために何も変えない: DO はすでに名前でキーされ、全行が `guild_id` を
持ち、read-only の SQL 実行器がすでに唯一のデータ経路になっている。

## 4. アーキテクチャ

```
Discord Gateway (wss://gateway.discord.gg/?v=10&encoding=json)
        ▲ bot ごとに outbound WebSocket 1 本(1 shard)
        │
┌───────┴──────────────────────────────────────────────┐   Worker: migiwa-bot
│ BotObject  (Durable Object, SQLite-backed)            │   apps/bot
│   gateway client: IDENTIFY / RESUME / heartbeat       │
│   allowlist + guild filter → sessionize → SQLite      │
│   KV storage: gateway 状態 (session_id, seq, …)       │
│   alarm: heartbeat ∪ reconnect backoff ∪ 日次 purge   │
│   RPC: ensureConnected(), status(), schema(), query() │
│   HTTP: GET /health(生存確認のみ)                     │
└───────┬──────────────────────────────────────────────┘
        │ cron "* * * * *" → ensureConnected()   (外形 watchdog)
        │
        │ DO binding, script_name = "migiwa-bot"
┌───────┴──────────────────────────────────────────────┐   Worker: migiwa-api
│ Hono                                                  │   apps/api
│   POST /mcp     Bearer API_TOKEN → MCP ツール `query`  │
│   GET  /health  connected なら 200、それ以外 503        │
└──────────────────────────────────────────────────────┘
```

- v1 の DO インスタンスはちょうど 1 つ、`idFromName("default")`。複数 bot の hosted 化で変わる
  のはこの名前だけ。
- DO は初回アクセス時に、最初のリクエストが着地した場所(Cloudflare のデフォルト配置)で作られる
  (改訂 2026-08-31: 以前の `locationHint: "enam"` 指定と PoC での `enam`/`wnam` 比較は行わない
  ことにした)。
- bot Worker の HTTP ルートは `GET /health` だけ(改訂 2026-08-31: 外形監視と dogfood の確認を api
  の deploy に依存させないため)。それ以外の入口は cron trigger と DO。

### 「接続は常時、プロセスは常時ではない」理由

Durable Object は `migiwa-bot` を deploy するたび、ランタイム更新のたび(予告なし、日 1〜2 回程度)、
そして incoming のリクエストやイベントが 70〜140 秒無いときに退避・再起動される。2026-06-19 以降は
outbound 接続が DO を alive に保つが、**接続ごとに最大 15 分**で、その後は通常の無活動ルールに戻る。
そのため本設計は「プロセスは 1 日に数回死ぬ」前提で再接続を安くする: 状態は全部ストレージに置き、
heartbeat の alarm を keep-alive に兼用し(41.25 秒 < 70 秒)、alarm チェーンが途切れた場合は cron
が DO を起こす。Discord から見れば bot は 1 日数回・数秒の空白を挟んで繋がっている状態で、これは
roppoh の discordgo がすでに毎日やっていたこと(「session invalidate → resume」が日常的に発生)と
同じである。

## 5. Gateway クライアント(`BotObject`)

### 5.1 状態

DO の KV storage(`ctx.storage.put("gateway", …)`)に持つ。ユーザーの SQL から読めないよう、
意図的に SQL のテーブルには置かない:

`session_id`, `seq`, `resume_gateway_url`, `status`(`connecting | connected | resuming | backoff
| fatal | stopped`), `status_reason`, `status_since`, `backoff_until`, `backoff_attempt`,
`identify_remaining`, `identify_reset_at`, `last_ack_at`, `last_heartbeat_at`, `last_event_at`,
`disconnected_at`, `bot_user_id`, `reconnects`(直近 24 時間のカウンタ)。

`seq` はそのイベント群と同じ `transactionSync` の中で書く(§6.4)ので、再起動後は最後にコミット
したイベントの直後から正確に RESUME でき、同じイベントを 2 回適用することはない。

### 5.2 `ensureConnected()`

v1 では cron が毎分呼ぶだけ。ソケットが open で最終 heartbeat ACK が heartbeat 2 周期以内なら、
または `backoff_until` が未来なら no-op。それ以外は `connect()` を実行する。RPC 名を `connect` に
しないのは、DO stub の `Fetcher.connect` と衝突するため(公開実装で既知のバグ)。

### 5.3 `connect()`

1. `session_id` と `resume_gateway_url` があれば、`${resume_gateway_url}?v=10&encoding=json` に
   WebSocket を開き `RESUME { token, session_id, seq }` を送る。
2. 無ければ `GET /gateway/bot`。
   - `shards > 1` → `status = fatal("sharding_required")`。v1 は 1 shard のみ。
   - `session_start_limit.remaining < 50` → `reset_after` まで待つ(status `backoff`)。
   - `${url}?v=10&encoding=json` を開き、HELLO を待って `IDENTIFY` を送る。intents は allowlist
     から導出: 常に `GUILDS | GUILD_VOICE_STATES`、`PRESENCE_UPDATE` が allowlist にあれば
     `GUILD_PRESENCES` を足す。
3. ソケットは `fetch(url, { headers: { Upgrade: "websocket" } })` と `response.webSocket.accept()`
   で開く。`new WebSocket()` は Workers ランタイムが `permessage-deflate` 拡張ヘッダを自動で付ける
   ので避ける。転送圧縮は要求しない(Discord は `zlib-stream` / `zstd-stream` を任意としている)。

### 5.4 heartbeat と alarm

DO の `alarm()` ハンドラは 1 つで、3 つの期限をメモリに持つ(再起動時は KV から復元):
`nextHeartbeatAt`, `nextReconnectAt`, `nextPurgeAt`。alarm は常にその最小値に、整数のタイムスタンプ
でセットする。

- HELLO 受信後、初回 heartbeat は `heartbeat_interval × random()` 後、以後 `heartbeat_interval`
  (41.25 秒)ごと。heartbeat は `setInterval` ではなく alarm から送る。タイマーは退避を防がないが
  alarm は防ぐため。
- heartbeat の期限が来たのに前回の ACK が無ければゾンビ接続とみなし、1000 以外の code で close
  して RESUME で再接続する。
- `alarm()` は `try/catch` で包み、失敗したら 30 秒後の fallback alarm を積む。チェーンが黙って
  終わることを防ぐ。
- purge(§6.5)は同じ alarm から 1 日 1 回走る。

### 5.5 dispatch の処理

受信メッセージは promise chain で厳密に順番どおり処理する。`op 0` はすべて `seq` を更新する。
イベントは 2 階層で扱う:

- **内部イベント(allowlist に関係なく常に処理)**: `READY`(`session_id`, `resume_gateway_url`,
  `bot_user_id` を保存)、`RESUMED`、`GUILD_CREATE`、`GUILD_DELETE`。
- **allowlist 対象**: それ以外の `t` のうち `EVENT_ALLOWLIST` に含まれ、`guild_id` が guild
  フィルタを通るものを `ingest()` へ渡す。

生 payload はログに出さない。出すのはイベント種別ごとの件数だけ。

### 5.6 切断時の分岐

| 事象 | 処理 |
|---|---|
| `op 7` Reconnect | 即 close、RESUME |
| `op 9` Invalid Session, `d = true` | 1〜5 秒後に RESUME |
| `op 9`, `d = false`; close 4003, 4007, 4009 | セッション状態を破棄、1〜5 秒後に IDENTIFY |
| close 4004, 4010, 4011, 4012, 4013, 4014(token 無効、intent 未許可、shard 設定不正) | `status = fatal(reason)`。1 日の IDENTIFY 予算を守るため再試行は 1 時間に 1 回まで |
| その他の close、ソケットエラー、heartbeat ACK 欠落 | 指数バックオフ `1 s × 2^n`(上限 5 分、jitter 付き)の後 RESUME |

`identify_remaining` / `identify_reset_at` は `GET /gateway/bot` のたびに更新し、IDENTIFY のたびに
減らす。1 日の上限は 1,000。

### 5.7 `status()`

`{ state, since, reason, last_event_at, seq, guild_count, reconnects_24h, identify_remaining }`
を返す。`/health` が使う。

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
voice_states_count }` に刈り込んで保存する。allowlist 対象のイベントは `d` をそのまま保存する。

意図的に捨てるもの: activity の `assets` / `party` / `secrets` / `buttons`(`events.payload` に 7 日
残る)、voice フラグの変更履歴、`client_status.vr`。

### 6.3 規則

セッション化は `packages/sessionizer` の純関数 `reduce(openRows, event, now) → ops`。`apps/bot`
が ops を Drizzle で適用する。以下の各規則がそのままテストケースになる。

| イベント | 規則 |
|---|---|
| `PRESENCE_UPDATE` | **status:** open 行の `status` が同じなら何もしない。違えば close(`status_change`、新 status が `offline` なら `offline`)し、新 status が `offline` でなければ新しい行を open。**activities:** payload の `(type, activity_key)` の集合を作り、集合に無い open 行を close(`activity_end`)、open 行が無いキーを open(`started_at` は Discord の `created_at` があればそれ、無ければ `received_at`)、両方にあるキーは `state` / `details` を更新。`offline` は activity 行も全部 close する。 |
| `VOICE_STATE_UPDATE` | open 行なし ∧ `channel_id ≠ null` → open。open 行あり ∧ `channel_id = null` → close(`leave`)。open 行あり ∧ `channel_id` が違う → close(`move`)して open。同じチャンネル → フラグ更新のみ。 |
| `GUILD_CREATE` | `guilds` を upsert。`presences[]` と `voice_states[]` を上の 2 規則で適用。その後**突き合わせ**: この guild の open 行のうち、スナップショットに居ない user を close(`snapshot_missing`、`ended_at` は `disconnected_at` があればそれ、無ければ `received_at`)。`member_count > 75,000` の guild は Discord が `presences` を bot と VC 参加者に刈り込むため、presence の突き合わせをスキップする。 |
| `GUILD_DELETE` | `unavailable = true`(障害): `guilds.available = 0` にし、セッションは開けたまま。それ以外(bot が外された): この guild の open 行を全部 close(`guild_removed`)し、guild を unavailable にする。 |
| `READY` / `RESUMED` | gateway 状態のみ更新。RESUME 成功後は replay されたイベントが通常の規則を通る。新規 IDENTIFY 後は `GUILD_CREATE` のスナップショットが補正を行う。 |

guild フィルタ: `DISCORD_GUILD_IDS` が設定されていれば、それ以外の guild のイベントは `ingest()`
前に捨て、その guild は追跡しない。

### 6.4 原子性と冪等性

dispatch 1 件につき、生 `events` の insert、セッションの ops、`seq` の書き込みを 1 つの
`ctx.storage.transactionSync(...)` で行う。`seq` は同期 KV API(`ctx.storage.kv.put`)で書く。
その API がトランザクション内で使えないと分かった場合は `seq` だけを 1 行の SQL テーブルに移す
(`seq` は機微ではない。`session_id` は KV に残す)。Drizzle のトランザクションのコールバックは同期で
なければならない(`drizzle-orm` issue #4322: async コールバックは処理完了前に返る)。規則は open 行
との状態比較なので同じイベントの再適用は no-op であり、正確な `seq` と合わせて RESUME で二重計上
は起きない。

### 6.5 保持期間(日次 alarm)

- `RAW_EVENT_RETENTION_DAYS`(既定 7)より古い `events` を削除。
- `ended_at` が `RETENTION_DAYS`(既定 30)より古い閉じたセッションを削除。
- 7 日以上開いているセッションは `timeout` で強制 close(安全弁)。

想定量(1,000 人 guild の調査見積り): 約 1,500 セッション/日、フラット行設計の約 1/3、30 日で
約 4.5 万行。DO あたり 10 GB の上限は v1 の規模では無関係。超えた先は §12。

### 6.6 Drizzle と migration

- `drizzle-orm@0.45.2` / `drizzle-kit@0.31.10`(stable。Drizzle のガイドはまだ `@rc` と書いて
  いるが無視する)。ドライバは `durable-sqlite`、`drizzle(ctx.storage, { schema })`。
- `packages/db/drizzle.config.ts` に `driver: "durable-sqlite"`、出力は `packages/db/drizzle/`、
  生成物は `linguist-generated=true`。migration は `bun run generate:migration` で手動生成し、CI で
  `drizzle-kit generate` が差分を生まないことを検査する。
- `BotObject` の constructor で `ctx.blockConcurrencyWhile(() => migrate(db, migrations))`。各 DO
  インスタンスが自分で migrate し、`__drizzle_migrations` が冪等にする。
- `db.transaction()` に async コールバックを渡さない。
- migration の検証は素の `wrangler dev` で行い、`@cloudflare/vite-plugin` 経由にしない(未解決の
  `DrizzleError: Rollback`、drizzle-orm #4558)。
- ローカルでの確認は `wrangler dev` の Local Explorer(`e` キー)。本番は Durable Objects Data
  Studio。Drizzle Studio と `drizzle-kit push` は DO 非対応。

## 7. API Worker(`migiwa-api`)

### 7.1 認証

`/health` 以外の全ルートは `Authorization: Bearer <API_TOKEN>` 必須、定数時間比較。無い・違う →
401。v1 は token 1 本で rate limit なし(`ponytail:` 呼び出し元が 2 つ以上になったら Rate Limiting
binding を足す)。

### 7.2 `POST /mcp`

`@modelcontextprotocol/sdk` の `McpServer` + `@hono/mcp` の `StreamableHTTPTransport` を stateless
モード(`sessionIdGenerator: undefined`)でリクエストごとに生成する。roppoh の
`discord-activity-remote-mcp` のパターン。CORS は `mcp-protocol-version` と `mcp-session-id`
ヘッダを許可する。

ツールはちょうど 1 つ、`query({ sql })`。`listTools()` が `["query"]` を返すことをテストで固定し、
定型メトリクスのツールが増えないようにする。設計の要点は「LLM が親切なテーブルに対して SQL を
書く」ことにある。

ツールの description は `packages/mcp` の純関数 `buildDescription(tables)` で生成する。`tables`
は DO から取る(`schema()` RPC が `sqlite_master` を読む)ので、常に実際のデータベースを反映する。
description が全テーブル・全列に触れていることをテストで確認する。description に含める内容:
テーブルの意味と `end_reason` の値、時刻は Unix ms(`datetime(started_at / 1000, 'unixepoch')`)、
open セッションは `ended_at IS NULL`、滞在時間は
`COALESCE(ended_at, unixepoch() * 1000) - started_at`、`events.payload` は JSON(`json_extract`)、
presence 行は guild ごとに重複する、必ず `LIMIT` を付ける。

### 7.3 read-only の担保(`BotObject.query(sql)`)

- コメントと空白を除いた先頭が `SELECT` / `WITH` / `EXPLAIN` のいずれかであること。2 文目(`;` の
  後に何かある)は拒否。`PRAGMA` と `ATTACH` は拒否。SQLite の `SELECT` は書き込めないので、これで
  十分。
- 行は `sql.exec()` のカーソルから読み、10,000 行で打ち切る。応答は
  `{ columns, rows, rows_read, truncated }`(`rows_read` はカーソルの実測値)。
- 実行時間の上限は DO の CPU 制限のみ(`ponytail:` v1 ではクエリタイムアウトなし)。
- gateway 状態は SQL ではなく KV にあるので、ここから `session_id` には届かない。

### 7.4 `GET /health`

同じ `/health` を `migiwa-bot` も持つが、実装は別物(改訂 2026-08-31)。bot 側は認証なしで
`BotObject` の状態を一切見ず、常に `200 { "message": "ok" }`(生存確認のみ)を返す。api 側の
下記の契約(gateway の state を返し、200/503 を分ける)は変えていない。PR A2 でこの契約を確定・変更する。

認証なし。`status().state === "connected"` なら `200 { "state": "connected" }`、それ以外は
`503 { "state": … }`。外形監視に登録することを想定した、cron に次ぐ「人間向け」の安全網。

## 8. 設定

| Worker | 名前 | 種別 | 既定値 | 意味 |
|---|---|---|---|---|
| bot | `DISCORD_BOT_TOKEN` | secret | 必須 | bot token。`wrangler.jsonc` の `secrets.required` に宣言 |
| bot | `DISCORD_GUILD_IDS` | var | 空 = 全 guild | 保持する guild id のカンマ区切り |
| bot | `EVENT_ALLOWLIST` | var | `PRESENCE_UPDATE,VOICE_STATE_UPDATE` | 取り込む Gateway イベント種別。intents もここから導出 |
| bot | `RAW_EVENT_RETENTION_DAYS` | var | `7` | `events` の保持日数 |
| bot | `RETENTION_DAYS` | var | `30` | 閉じたセッションの保持日数 |
| api | `API_TOKEN` | secret | 必須 | `/mcp` の bearer token |
| api | `BOT` | DO binding | — | `class_name: BotObject`, `script_name: migiwa-bot` |

secret は Secrets Store ではなく通常の Worker secret(`wrangler secret put`)。self-host を Worker
ごと 2 コマンドに収めるため。self-host 手順: `wrangler secret put` × 2、`wrangler deploy` × 2、
MCP クライアントに `https://<api>/mcp` と bearer token を設定する。

## 9. エラー処理と観測

- dispatch 1 件の処理中の例外はログに出して次へ進む。アプリケーションエラーでソケットを閉じる
  ことはしない。
- `alarm()` の失敗は 30 秒後の fallback alarm を積む(§5.4)。`connect()` の失敗はバックオフへ(§5.6)。
- ログは Workers Logs(`observability.logs.enabled`)に JSON 1 行ずつ: 接続イベント(identify /
  resume / close code / fatal 理由)、種別ごとの ingest 件数、purge 件数。payload は決して出さない。
  メトリクス基盤は作らない(`ponytail:` Workers Logs のクエリで足りる)。

## 10. テスト

1. **`bun test`(純粋ロジック、`packages/*`)**: セッション化の規則(§6.3 の表そのまま)、close
   code の表とバックオフ、read-only SQL ガード、`buildDescription`。
2. **`@cloudflare/vitest-plugin`(`apps/*`、実 workerd)**: `@msw/cloudflare` の `ws.link()` による
   モック Gateway に対する `BotObject`(HELLO → IDENTIFY → READY → dispatch → op 7 → RESUME)、
   `evictDurableObject({ webSockets: "close" })` 後に保存済み `seq` で RESUME が成功すること、
   新規 DO への migration 適用、`InMemoryTransport` 経由の MCP、bot の `/health` が常に
   `200 { "message": "ok" }` を返すこと(改訂 2026-08-31)、api の `/health` の 200/503、
   `sqlite_master` と description のズレ検査。
3. **Task 0 PoC(手動)**: 作者のアカウントに deploy し、実 Gateway に 24 時間繋いで、ログと
   `/health` で再接続が稀であること、再起動後の RESUME が成功すること、Cloudflare からの egress
   がブロックされていないこと(Discord は 2025-12-05 に Workers からの接続ブロックを解除)を確認する。

## 11. リポジトリ、ツールチェーン、CI

roppoh の形の monorepo: `apps/*` は薄いデプロイ単位、`packages/*` は `bun test` で動くロジック。

```
migiwa/
  package.json           bun workspaces ["apps/*", "packages/*"]、workspaces.catalog で共有バージョンを固定
  turbo.json             build / type-check / cf-typegen / test / dev
  tsconfig.json          roppoh の strict 一式(verbatimModuleSyntax, noUncheckedIndexedAccess, bundler, types: [])
  oxlint.config.ts  oxfmt.config.ts  knip.config.ts  lefthook.yml  renovate.json  bunfig.toml  .npmrc  mise.toml
  .gitattributes         生成物に linguist-generated=true
  AGENTS.md  CLAUDE.md   規約(英語。.claude/rules ツリーは持たない)
  apps/bot/              migiwa-bot: entry.ts, bot-object.ts, wrangler.jsonc(DO, migrations, cron)
  apps/api/              migiwa-api: entry.ts, server.ts, routes/{mcp,health}.ts, middlewares/, wrangler.jsonc
  packages/db/           Drizzle スキーマ、drizzle.config.ts、drizzle/ migration、行型
  packages/gateway/      プロトコルのみ: opcode、close code 表、IDENTIFY/RESUME payload、heartbeat 状態機械
  packages/sessionizer/  reduce(openRows, event, now) → ops
  packages/mcp/          McpServer factory、query ツール、buildDescription
  docs/specs/            設計文書(日本語)
  README.md  LICENSE (AGPL-3.0)  CONTRIBUTING.md
```

ツールチェーンは roppoh の現行値をそのまま: bun 1.3.14 / node 24(`packageManager` + bun・node・
lefthook だけに絞った `mise.toml`)、catalog で管理する TypeScript 7.0.2 と型付き lint の
`oxlint-tsgolint`、oxlint 1.77(全 category `error`、`typeAware`、`typeCheck`)、oxfmt 0.63
(printWidth 100、セミコロンあり、ダブルクォート、trailing comma、roppoh の import グループ)、
workspace ごとに entry を指定した knip、lefthook の pre-commit 並列実行(install dry-run、
`stage_fixed` 付きの oxfmt と oxlint、`turbo build`、root と turbo の type-check、`stage_fixed` 付きの
`turbo cf-typegen`、knip、renovate-config-validator)、roppoh の `wrangler.jsonc` 規約に従う
wrangler 4.120(`$schema`、`nodejs_compat`、`observability.logs`、`secrets.required` の明示、
`workers_dev: true`(dogfood 中は両 Worker を workers.dev で公開する。改訂 2026-08-31。
カスタムドメインに移す時に `false` へ戻す)、`upload_source_maps`)、`worker-configuration.d.ts` を生成する
`wrangler types --strict-vars=false`、catalog 用 regex manager と `bun install --lockfile-only` の
post-upgrade task と dependency dashboard approval を持つ renovate `config:recommended`。
`@roppoh/oxlint-plugins`(React/Inertia 用ルール)は持ち込まない。

CI は GitHub-hosted runner(public リポジトリ):

| workflow | 内容 |
|---|---|
| `ci.yml` | oxfmt / oxlint / type-check / knip / `bun test` / vitest / `wrangler types --check` / `wrangler deploy --dry-run` を 1 本に集約(改訂 2026-08-31) |
| `drizzle-ci.yml` | migrate 検査 + drift 検査(改訂 2026-08-31: `drizzle-drift-ci.yml` から改称・統合) |
| renovate config validation | lefthook のフックと同じ検査 |

**deploy は GitHub Actions では行わない**(改訂 2026-08-31)。Cloudflare ダッシュボードの GitHub
連携(Workers Builds)がリポジトリを監視して `migiwa-bot` をビルド・deploy する。deploy の設定
(ビルドコマンド、ルートディレクトリ、対象ブランチ)は Cloudflare 側にあり、GitHub 側に
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` は要らない。リポジトリ内で deploy 可能性を
担保するのは `ci.yml` の `wrangler deploy --dry-run` だけ(バンドルが壊れていれば PR で落ちる)。

言語とライセンス: コード・コメント・README・コミットメッセージ・PR は英語、`docs/specs/` の設計
文書は日本語(D10)。`LICENSE` は AGPL-3.0。CLA は最初の外部 PR が来た時点で導入する(それまで
著作権者は 1 人)。roppoh 側の proxy、Pipelines、R2 Data Catalog、`catalog-sync` の廃止は roppoh
側の作業で、v1 が 1 週間安定してから行う。

## 12. リスクと対策

| リスク | 対策 |
|---|---|
| DO は 1 日に数回再起動する。outbound の keep-alive は 15 分上限。hibernation は outbound ソケットに適用されない(workerd #4864 は open) | RESUME を正常経路として設計(§5)。alarm による keep-alive、cron の watchdog、人間向けの `/health` |
| 再接続ループのバグで 1 日 1,000 回の IDENTIFY 予算を使い切る | 予算を追跡し 50 回を予備として残す。fatal な code は 1 時間ごとの再試行。あらゆる場面で RESUME を優先 |
| Discord は 2025-12-05 まで Cloudflare の egress からの Gateway 接続をブロックしていた | Task 0 PoC。Containers(Go バイナリ)を文書化したフォールバックとして残す |
| DO の SQLite はオブジェクトあたり 10 GB のハード上限 | 生行ではなくセッションを保存、生イベントは 7 日保持、プラン別の保持期間。それでも超えるなら `guild_id` で保存を shard する(全テーブルと全規則がすでに guild スコープ) |
| guild 数 2,500 以上の bot は sharding が必要で RESUME もできない | `GET /gateway/bot` の時点で `fatal("sharding_required")` として拒否。v1 のスコープ外 |
| hosted の費用下限は常時起動 DO 1 つあたり約 $4.2/月(無料枠 400,000 GB-s を超えた分) | v1 では許容(DO は 1 つで、Workers Paid の枠内でほぼ無料)。v2 の価格設定で回収する |
| Discord Developer Policy はユーザー間の関係性のプロファイリングを禁止 | 「誰が誰と一緒だったか」系の機能は作らない。user × guild 単位の presence / voice / activity のみ。v2 の利用規約に §12(a) の Service Provider 義務(at-rest 暗号化、解約時削除)を入れる |
| Drizzle の DO ドライバが若い(#4322、#4558 が open) | 同期トランザクションのみ、stable バージョン、migration 検証は `wrangler dev` |

## 13. 費用モデル(参考)

Durable Objects: duration は 128 MB で $12.50/百万 GB-s → 常時起動 DO 1 つで約 $4.20/月。Workers
Paid($5/月)に 400,000 GB-s/月が含まれる。リクエストは $0.15/百万(incoming の WebSocket メッセージは
20:1 で換算)。SQLite の rows written は 5,000 万を超えた分が $1.00/百万、rows read は 250 億を超えた
分が $0.001/百万、ストレージは 5 GB を超えた分が $0.20/GB-月。したがって v1 は有料プランの内包量の
中で動く。調査時の参照点: Cloudflare Containers は大規模時に約 $2.05/接続/月、Fly.io 約 $2.04、
Railway 約 $5。

## 14. 調査の記録

上記の数値はすべて 2026-08-26 に一次情報(developers.cloudflare.com とその changelog、
docs.discord.com、github.com/discord/discord-api-docs、orm.drizzle.team、turso.tech、roppoh
リポジトリ)に対して行った調査に基づく。日付付きの主な事実: Containers GA 2026-04-13、outbound
接続が DO を alive に保つ 2026-06-19、DO の eviction テストヘルパ 2026-06-25、R2 SQL 課金開始
2026-08-03、Discord の特権 intent 審査が 10,000 ユニークユーザー基準・年次再申請に変更 2026-06-10、
Discord が Workers からの Gateway 接続を再許可 2025-12-05、Turso の有料プランで DB 数無制限
2026-05-03。
