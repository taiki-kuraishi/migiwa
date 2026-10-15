output "stream_id" {
  description = "Stream ID for the `pipelines` binding in the bot Worker's wrangler.jsonc."
  value       = cloudflare_pipeline_stream.events.id
}

output "stream_endpoint" {
  description = "Authenticated HTTP ingest endpoint of the stream."
  value       = cloudflare_pipeline_stream.events.endpoint
}

output "bucket_name" {
  description = "R2 bucket holding the Basin Catalog; maintenance.sh reads it."
  value       = cloudflare_r2_bucket.events.name
}

output "warehouse" {
  description = "Basin SQL / Iceberg REST warehouse name."
  value       = cloudflare_r2_data_catalog.events.name
}

output "table" {
  description = "Fully qualified Iceberg table the sink writes to."
  value       = "${var.namespace}.${var.table_name}"
}
