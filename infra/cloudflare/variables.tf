variable "account_id" {
  description = "Cloudflare account that owns the Basin resources."
  type        = string
}

# 手で発行し（provider の token は token を作れない）、Secrets Manager に
# MIGIWA_CLOUDFLARE_SINK_TOKEN として保存する。`fnox exec` が TF_VAR_sink_token として export する。
# token はその bucket に scope されるので、token ができる前に bucket と catalog を -target で apply
# できるよう null を許す。
# 値を変えると sink が作り直され（設定は変えられない）、新しい sink は既存の table に書けないので、
# この token の rotate は *_v2 の table への移行になる。
variable "sink_token" {
  description = "Token the pipeline sink writes to Basin Catalog with (Data Catalog Write + Bucket Item Write on migiwa-events)."
  type        = string
  sensitive   = true
  default     = null
}

# bot と集計の Worker はこれらを名前で参照するので、deploy ごとの入力にせず固定する。
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
