resource "cloudflare_r2_bucket" "events" {
  account_id = var.account_id
  name       = var.bucket_name
  # The hand-issued sink and maintenance tokens are scoped to
  # com.cloudflare.edge.r2.bucket.<account>_default_migiwa-events; Basin Catalog also rejects
  # non-default jurisdictions.
  jurisdiction = "default"
}

# Compaction and snapshot expiration are computed-only here; maintenance.sh sets them.
resource "cloudflare_r2_data_catalog" "events" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.events.name
}

# Stream schema, sink config and pipeline SQL are immutable once created: any change here
# replaces the resource, so evolve the record shape by adding a *_v2 set instead.
resource "cloudflare_pipeline_stream" "events" {
  account_id = var.account_id
  name       = var.stream_name
  format     = { type = "json" }
  schema = {
    fields = [
      # millisecond lets the bot send Date.now() as-is; RFC 3339 strings are accepted too.
      { name = "received_at", type = "timestamp", unit = "millisecond", required = true },
      { name = "type", type = "string", required = true },
      { name = "session_id", type = "string", required = true },
      # Discord dispatches carry `s`, but the gateway may emit events without one.
      # (session_id, seq) is the dedup key readers apply; Pipelines cannot enforce uniqueness.
      { name = "seq", type = "int64", required = false },
      # Snowflakes exceed 2^53, so they stay strings end to end.
      { name = "guild_id", type = "string", required = false },
      { name = "channel_id", type = "string", required = false },
      { name = "user_id", type = "string", required = false },
      { name = "payload", type = "json", required = true },
    ]
  }
  http = {
    enabled        = true
    authentication = true
    # The API echoes back an empty cors object; omitting it leaves a permanent in-place diff.
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
