# The personal account is shared with other repos, which is why the secrets carry a MIGIWA_ prefix.
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
