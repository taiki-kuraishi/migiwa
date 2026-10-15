terraform {
  # use_lockfile (S3-native state locking) needs 1.10+.
  required_version = ">= 1.10"

  # Run with AWS_PROFILE=kuraishi (IAM Identity Center SSO: `aws sso login --profile kuraishi`).
  backend "s3" {
    bucket       = "kuraishi-migiwa-tfstate"
    key          = "aws/terraform.tfstate"
    region       = "ap-northeast-1"
    encrypt      = true
    use_lockfile = true

    assume_role = {
      role_arn = "arn:aws:iam::756921148444:role/OrganizationAccountAccessRole"
    }
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.69.0"
    }
  }
}
