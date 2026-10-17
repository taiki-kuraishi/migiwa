# 入れ物だけを作る。値は Terraform を通さず `fnox set` で書くので、state に入らない。
resource "aws_secretsmanager_secret" "cloudflare_api_token" {
  name        = "MIGIWA_CLOUDFLARE_API_TOKEN"
  description = "Cloudflare provider token for infra/cloudflare."
}

resource "aws_secretsmanager_secret" "cloudflare_sink_token" {
  name        = "MIGIWA_CLOUDFLARE_SINK_TOKEN"
  description = "Catalog write token that the migiwa_events_v1 pipeline sink writes to Basin Catalog with."
}

resource "aws_secretsmanager_secret" "cloudflare_maintenance_token" {
  name        = "MIGIWA_CLOUDFLARE_MAINTENANCE_TOKEN"
  description = "Service credential for Basin Catalog compaction and snapshot expiration on migiwa-events."
}
