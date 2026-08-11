# Only the reverse proxy is exposed. There is no SSH rule by default: shell
# access is SSM Session Manager, which dials out from the instance, so the
# security group needs no inbound port for it.

resource "aws_security_group" "web" {
  name        = "${local.name_prefix}-web"
  description = "Public HTTP/HTTPS ingress for the Caddy reverse proxy"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-web" }

  lifecycle {
    create_before_destroy = true
  }
}

# Port 80 stays open to the world regardless of allowed_web_cidrs: Let's Encrypt
# validates the HTTP-01 challenge from rotating, undocumented source addresses.
# Caddy serves nothing else on 80 — every other path is redirected to 443.
resource "aws_vpc_security_group_ingress_rule" "http_acme" {
  security_group_id = aws_security_group.web.id
  description       = "HTTP - ACME HTTP-01 challenge + redirect to HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  for_each = toset(var.allowed_web_cidrs)

  security_group_id = aws_security_group.web.id
  description       = "HTTPS"
  cidr_ipv4         = each.value
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# HTTP/3. Harmless to allow; browsers fall back to TCP when it is blocked.
resource "aws_vpc_security_group_ingress_rule" "https_quic" {
  for_each = toset(var.allowed_web_cidrs)

  security_group_id = aws_security_group.web.id
  description       = "HTTP/3 (QUIC)"
  cidr_ipv4         = each.value
  from_port         = 443
  to_port           = 443
  ip_protocol       = "udp"
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  for_each = toset(var.allowed_ssh_cidrs)

  security_group_id = aws_security_group.web.id
  description       = "Break-glass SSH"
  cidr_ipv4         = each.value
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"
}

# EC2 only accepts rule descriptions built from a-zA-Z0-9 and ". _-:/()#,@[]+=&;{}!$*".
# An apostrophe is rejected at apply time, so this says ACME rather than Let's Encrypt.
resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.web.id
  description       = "Outbound to SSM, ECR, S3, ACME, GitHub"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
