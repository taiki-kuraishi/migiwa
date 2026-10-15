#!/bin/sh
# Basin Catalog table maintenance for the bucket that main.tf creates. The Cloudflare
# provider only exposes cloudflare_r2_data_catalog.maintenance_config as computed, so
# compaction and snapshot expiration are set here through Wrangler instead.
#
# Run after `terraform apply` with AWS_PROFILE=kuraishi (S3 state) and CLOUDFLARE_ACCOUNT_ID
# set, under `fnox exec` started from inside the repo: fnox finds fnox.toml by walking up from
# the cwd, and that supplies CLOUDFLARE_API_TOKEN and CLOUDFLARE_MAINTENANCE_TOKEN.
# Snapshot expiration needs Wrangler >= 4.56.0; WRANGLER / TERRAFORM override how each CLI is
# invoked. Re-running overwrites the settings with the same values.
set -eu

: "${CLOUDFLARE_MAINTENANCE_TOKEN:?run under fnox exec}"
terraform=${TERRAFORM:-terraform}
wrangler=${WRANGLER:-bunx wrangler}

cd "$(dirname "$0")"

bucket=$($terraform output -raw bucket_name)

# Catalog-level (not per-table) so a future events_v2 is covered too; Cloudflare keeps this
# token as the catalog's service credential for the maintenance jobs.
$wrangler basin catalog compaction enable "$bucket" --target-size 128 \
  --token "$CLOUDFLARE_MAINTENANCE_TOKEN"
# 7 days / 10 snapshots is the user's choice: the low end of Cloudflare's production-analytics
# range, enough history to debug a bad compaction before its snapshot is gone.
$wrangler basin catalog snapshot-expiration enable "$bucket" \
  --token "$CLOUDFLARE_MAINTENANCE_TOKEN" --older-than-days 7 --retain-last 10

$wrangler basin catalog get "$bucket"
