resource "cloudflare_r2_bucket" "events" {
  account_id = var.account_id
  name       = var.bucket_name
  # 手で発行する sink と maintenance の token は
  # com.cloudflare.edge.r2.bucket.<account>_default_migiwa-events に scope されている。Basin Catalog も
  # default 以外の jurisdiction を受け付けない。
  jurisdiction = "default"
}

# compaction と snapshot expiration はここでは computed のみ。設定するのは maintenance.sh。
resource "cloudflare_r2_data_catalog" "events" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.events.name
}

# stream の schema、sink の設定、pipeline の SQL は作成後に変えられず、ここを変えると resource が
# 作り直される。record の形を変えるときは *_v2 の一式を足す。
resource "cloudflare_pipeline_stream" "events" {
  account_id = var.account_id
  name       = var.stream_name
  format     = { type = "json" }
  schema = {
    fields = [
      # millisecond なら bot が Date.now() をそのまま送れる。RFC 3339 の文字列も受け付ける。
      { name = "received_at", type = "timestamp", unit = "millisecond", required = true },
      { name = "type", type = "string", required = true },
      { name = "session_id", type = "string", required = true },
      # Discord の dispatch は `s` を持つが、gateway は `s` の無い event も出しうる。
      # (session_id, seq) は読む側が使う重複排除の key。Pipelines は一意性を強制できない。
      { name = "seq", type = "int64", required = false },
      # snowflake は 2^53 を超えるので、最初から最後まで文字列のまま扱う。
      { name = "guild_id", type = "string", required = false },
      { name = "channel_id", type = "string", required = false },
      { name = "user_id", type = "string", required = false },
      { name = "payload", type = "json", required = true },
    ]
  }
  http = {
    enabled        = true
    authentication = true
    # API は空の cors object を返してくる。省略すると in-place の diff が消えずに残る。
    cors = {}
  }
  worker_binding = { enabled = true }
}

resource "cloudflare_pipeline_sink" "events" {
  account_id = var.account_id
  name       = var.sink_name
  type       = "r2_data_catalog"
  format     = { type = "parquet" }
  schema     = { fields = [] }
  config = {
    account_id = var.account_id
    bucket     = cloudflare_r2_data_catalog.events.bucket_name
    namespace  = var.namespace
    table_name = var.table_name
    token      = var.sink_token
  }

  lifecycle {
    precondition {
      condition     = var.sink_token != null
      error_message = "Set TF_VAR_sink_token (fnox exec) before creating the sink."
    }
  }
}

resource "cloudflare_pipeline" "events" {
  account_id = var.account_id
  name       = var.pipeline_name
  sql        = "INSERT INTO ${cloudflare_pipeline_sink.events.name} SELECT * FROM ${cloudflare_pipeline_stream.events.name}"
}

# Secrets Store は 1 アカウントに 1 つしか作れず（open beta）、ほかの用途と共有しうるので、Terraform では
# 管理せず参照だけする。
data "cloudflare_secrets_stores" "account" {
  account_id = var.account_id
}

resource "cloudflare_secrets_store_secret" "discord_bot_token" {
  account_id = var.account_id
  store_id   = one(data.cloudflare_secrets_stores.account.result).id
  name       = var.discord_bot_token_secret_name
  scopes     = ["workers"]
  value      = var.discord_bot_token
}
