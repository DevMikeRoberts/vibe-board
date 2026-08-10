# Route 53 is the one line item with an unavoidable monthly charge: $0.50 per
# hosted zone. Reuse an existing zone (the default) rather than creating a
# second one for the same domain.

resource "aws_route53_zone" "main" {
  count = var.create_hosted_zone ? 1 : 0

  name    = var.hosted_zone_name
  comment = "Managed by Terraform for ${local.name_prefix}"
}

data "aws_route53_zone" "main" {
  count = var.create_hosted_zone ? 0 : 1

  name         = "${var.hosted_zone_name}."
  private_zone = false
}

locals {
  hosted_zone_id = var.create_hosted_zone ? aws_route53_zone.main[0].zone_id : data.aws_route53_zone.main[0].zone_id
}

resource "aws_route53_record" "board" {
  zone_id = local.hosted_zone_id
  name    = var.domain_name
  type    = "A"
  ttl     = 60
  records = [aws_eip.board.public_ip]
}
