output "board_url" {
  description = "Public URL of the board."
  value       = local.board_url
}

output "instance_id" {
  description = "EC2 instance ID. `aws ssm start-session --target <id>` for a shell."
  value       = aws_instance.board.id
}

output "instance_public_ip" {
  description = "Elastic IP attached to the instance (the address the DNS record points at)."
  value       = aws_eip.board.public_ip
}

output "instance_name_tag" {
  description = "Name tag the deploy workflow uses to find the instance (repo variable EC2_NAME_TAG)."
  value       = local.name_prefix
}

output "github_actions_role_arn" {
  description = "Role GitHub Actions assumes via OIDC (repo secret AWS_DEPLOY_ROLE_ARN)."
  value       = aws_iam_role.github_deploy.arn
}

output "ecr_registry" {
  description = "ECR registry host for this account/region."
  value       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
}

output "ecr_server_repository" {
  description = "ECR repository for the backend image (repo variable ECR_SERVER_REPO)."
  value       = aws_ecr_repository.server.name
}

output "ecr_web_repository" {
  description = "ECR repository for the frontend image (repo variable ECR_WEB_REPO)."
  value       = aws_ecr_repository.web.name
}

output "deploy_bucket" {
  description = "S3 bucket holding the deploy bundle (repo variable AWS_DEPLOY_BUCKET)."
  value       = aws_s3_bucket.deploy.id
}

output "ssm_parameter_prefix" {
  description = "Parameter Store prefix holding the runtime secrets."
  value       = local.ssm_prefix
}

output "secret_parameters_to_populate" {
  description = "Parameters created with a REPLACE_ME placeholder — set each one before the first deploy."
  value       = sort([for name, _ in local.secret_parameters : "${local.ssm_prefix}/${name}"])
}

output "hosted_zone_nameservers" {
  description = "Nameservers to set at your registrar. Only populated when this stack creates the hosted zone."
  value       = coalesce(one(aws_route53_zone.main[*].name_servers), [])
}

# When DNS is managed elsewhere this is the whole handover: one A record.
output "dns_record_to_create" {
  description = "The DNS record to create by hand. Null when Terraform manages Route 53 for you."
  value = var.manage_dns ? null : {
    type  = "A"
    host  = split(".", var.domain_name)[0]
    name  = var.domain_name
    value = aws_eip.board.public_ip
    ttl   = 300
    note  = "Create this at your DNS provider before deploying. Caddy cannot obtain a certificate until the name resolves publicly."
  }
}

output "github_actions_repo_variables" {
  description = "Copy-paste block of the GitHub repository variables the deploy workflow expects."
  value = {
    AWS_REGION        = var.aws_region
    AWS_DEPLOY_BUCKET = aws_s3_bucket.deploy.id
    ECR_SERVER_REPO   = aws_ecr_repository.server.name
    ECR_WEB_REPO      = aws_ecr_repository.web.name
    EC2_NAME_TAG      = local.name_prefix
    IMAGE_PLATFORM    = var.instance_architecture == "arm64" ? "linux/arm64" : "linux/amd64"
  }
}
