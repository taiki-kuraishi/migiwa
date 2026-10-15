provider "aws" {
  region = "ap-northeast-1"

  assume_role {
    role_arn = "arn:aws:iam::${var.aws_account_id}:role/${var.aws_account_role_name}"
  }
}
