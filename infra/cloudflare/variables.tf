variable "account_id" {
  description = "Cloudflare account that owns the Basin resources."
  type        = string
}

# Issued by hand (the provider token cannot create tokens) and stored in Secrets Manager as
# MIGIWA_CLOUDFLARE_SINK_TOKEN; `fnox exec` exports it as TF_VAR_sink_token. Null is allowed so
# the bucket and catalog can be applied with -target before the token exists, since the token
# is scoped to that bucket.
# Changing the value replaces the sink (its config is immutable), and a new sink cannot write
# into the existing table, so rotating this token means moving to a *_v2 table.
variable "sink_token" {
  description = "Token the pipeline sink writes to Basin Catalog with (Data Catalog Write + Bucket Item Write on migiwa-events)."
  type        = string
  sensitive   = true
  default     = null
}

# Bot and aggregation Workers address these by name, so they are fixed rather than per-deploy inputs.
variable "bucket_name" {
  description = "R2 bucket that holds the Basin Catalog."
  type        = string
  default     = "migiwa-events"
}

variable "namespace" {
  description = "Iceberg namespace of the raw event table."
  type        = string
  default     = "discord"
}

variable "table_name" {
  description = "Iceberg table the sink creates and writes raw Gateway dispatches to."
  type        = string
  default     = "events_v1"
}

variable "stream_name" {
  description = "Stream the bot Worker sends raw Gateway dispatches to."
  type        = string
  default     = "migiwa_events_v1"
}

variable "sink_name" {
  description = "Sink that writes the stream into the Iceberg table."
  type        = string
  default     = "migiwa_events_v1_sink"
}

variable "pipeline_name" {
  description = "Pipeline that connects the stream to the sink."
  type        = string
  default     = "migiwa_events_v1_pipeline"
}
