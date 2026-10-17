# 個人 account はほかの repo と共有しているので、secret には MIGIWA_ の prefix を付けている。
variable "aws_account_id" {
  description = "Personal AWS account that holds the Secrets Manager secrets."
  type        = string
  default     = "297580067274"
}

variable "aws_account_role_name" {
  description = "Role the aws provider assumes in the personal AWS account."
  type        = string
  default     = "OrganizationAccountAccessRole"
}
