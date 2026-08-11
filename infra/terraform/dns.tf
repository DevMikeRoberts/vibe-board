# DNS is optional. When the domain's authoritative nameservers live somewhere
# else — Squarespace, Cloudflare, your registrar — leave `manage_dns = false`
# and point a single A record at the Elastic IP by hand. Nothing else in the
# stack depends on Route 53, and skipping it also skips the $0.50/month a
# hosted zone costs.
#
# The instance always gets an Elastic IP, so the record you create by hand
# survives instance replacement.

resource "aws_route53_zone" "main" {
  count = var.manage_dns && var.create_hosted_zone ? 1 : 0

  name    = var.hosted_zone_name
  comment = "Managed by Terraform for ${local.name_prefix}"
}

data "aws_route53_zone" "main" {
  count = var.manage_dns && !var.create_hosted_zone ? 1 : 0

  name         = "${var.hosted_zone_name}."
  private_zone = false
}

locals {
  # one() over a splat rather than [0]: with count = 0 the index would be
  # evaluated even on the branch that is not taken, and error.
  hosted_zone_id = var.manage_dns ? coalesce(
    one(aws_route53_zone.main[*].zone_id),
    one(data.aws_route53_zone.main[*].zone_id),
  ) : null
}

resource "aws_route53_record" "board" {
  count = var.manage_dns ? 1 : 0

  zone_id = local.hosted_zone_id
  name    = var.domain_name
  type    = "A"
  ttl     = 60
  records = [aws_eip.board.public_ip]
}
