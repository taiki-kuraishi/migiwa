#!/bin/sh
# main.tf が作る bucket の Basin Catalog の table を保守する。Cloudflare provider は
# cloudflare_r2_data_catalog.maintenance_config を computed でしか公開していないので、
# compaction と snapshot expiration はここで Wrangler から設定する。
#
# `terraform apply` の後に、AWS_PROFILE=kuraishi（S3 の state）と CLOUDFLARE_ACCOUNT_ID を設定し、
# repo の中から起動した `fnox exec` の下で実行する。fnox は cwd から上へたどって fnox.toml を見つけ、
# それが CLOUDFLARE_API_TOKEN と CLOUDFLARE_MAINTENANCE_TOKEN を渡す。
# snapshot expiration には Wrangler 4.56.0 以上が要る。WRANGLER / TERRAFORM で各 CLI の呼び方を
# 上書きできる。再実行すると同じ値で設定を上書きする。
set -eu

: "${CLOUDFLARE_MAINTENANCE_TOKEN:?run under fnox exec}"
terraform=${TERRAFORM:-terraform}
wrangler=${WRANGLER:-bunx wrangler}

cd "$(dirname "$0")"

bucket=$($terraform output -raw bucket_name)

# table ごとではなく catalog 単位にして、将来の events_v2 も対象にする。Cloudflare はこの token を
# maintenance job 用の catalog の service credential として保持する。
$wrangler basin catalog compaction enable "$bucket" --target-size 128 \
  --token "$CLOUDFLARE_MAINTENANCE_TOKEN"
# 7 日 / 10 snapshot は user が選んだ値。Cloudflare の production-analytics の範囲の下限で、
# 壊れた compaction の snapshot が消える前に調べられるだけの履歴が残る。
$wrangler basin catalog snapshot-expiration enable "$bucket" \
  --token "$CLOUDFLARE_MAINTENANCE_TOKEN" --older-than-days 7 --retain-last 10

$wrangler basin catalog get "$bucket"
