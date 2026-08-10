# Runtime secrets live in SSM Parameter Store (Standard tier — free, encrypted
# with the AWS-managed aws/ssm key). Terraform creates each parameter with a
# placeholder and then ignores its value forever, so no real secret is ever
# written to Terraform state. Populate them once after the first apply:
#
#   aws ssm put-parameter --name /agentboard/prod/API_KEY \
#     --type SecureString --value "$(openssl rand -hex 32)" --overwrite
#
# deploy.sh reads the whole prefix at deploy time and renders /opt/agentboard/.env.

resource "aws_ssm_parameter" "secret" {
  for_each = local.secret_parameters

  name        = "${local.ssm_prefix}/${each.key}"
  description = each.value
  type        = "SecureString"
  tier        = "Standard"
  value       = "REPLACE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "plain" {
  for_each = local.plain_parameters

  name  = "${local.ssm_prefix}/${each.key}"
  type  = "String"
  tier  = "Standard"
  value = each.value

  lifecycle {
    ignore_changes = [value]
  }
}
