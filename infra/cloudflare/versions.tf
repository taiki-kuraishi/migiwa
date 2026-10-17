terraform {
  # use_lockfile（S3 だけで state を lock する）には 1.10 以上が要る。
  required_version = ">= 1.10"

  # AWS_PROFILE=kuraishi で実行する（IAM Identity Center SSO: `aws sso login --profile kuraishi`）。
  backend "s3" {
    bucket       = "kuraishi-migiwa-tfstate"
    key          = "cloudflare/terraform.tfstate"
    region       = "ap-northeast-1"
    encrypt      = true
    use_lockfile = true

    assume_role = {
      role_arn = "arn:aws:iam::756921148444:role/OrganizationAccountAccessRole"
    }
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.27.0"
    }
  }
}
