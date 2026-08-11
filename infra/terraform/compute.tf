# One always-on instance. Everything that must outlive it — the SQLite
# database, cloned repos, TLS certificates — sits on a separate EBS volume, so
# the instance itself is disposable: change the AMI or the user data and
# Terraform can replace it without touching state on disk.

data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-${var.instance_architecture}"
}

# Persistent state. prevent_destroy is deliberate — `terraform destroy` will
# refuse until you remove it, which is the point of "persistent". See
# docs/AWS_DEPLOYMENT.md#teardown.
resource "aws_ebs_volume" "data" {
  availability_zone = aws_subnet.public.availability_zone
  size              = var.data_volume_size
  type              = "gp3"
  encrypted         = true

  tags = { Name = "${local.name_prefix}-data" }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_instance" "board" {
  ami                    = data.aws_ssm_parameter.al2023_ami.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]
  iam_instance_profile   = aws_iam_instance_profile.instance.name
  key_name               = var.ssh_key_name
  monitoring             = var.enable_detailed_monitoring

  user_data                   = local.user_data
  user_data_replace_on_change = true

  root_block_device {
    volume_size           = var.root_volume_size
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true

    tags = { Name = "${local.name_prefix}-root" }
  }

  # IMDSv2 only — blocks the SSRF-to-credentials path against a public service.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
    instance_metadata_tags      = "enabled"
  }

  tags = { Name = local.name_prefix }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/xvdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.board.id

  # Stop the instance before detaching so the filesystem is not ripped out
  # from under a running container.
  stop_instance_before_detaching = true
}

# A stable address, so the Route 53 record survives instance replacement.
resource "aws_eip" "board" {
  domain = "vpc"

  tags = { Name = "${local.name_prefix}-eip" }
}

resource "aws_eip_association" "board" {
  instance_id   = aws_instance.board.id
  allocation_id = aws_eip.board.id
}

locals {
  user_data = templatefile("${path.module}/templates/user-data.sh.tftpl", {
    aws_region             = var.aws_region
    project_name           = var.project_name
    environment            = var.environment
    ssm_prefix             = local.ssm_prefix
    deploy_bucket          = aws_s3_bucket.deploy.id
    ecr_registry           = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
    server_repository      = aws_ecr_repository.server.name
    web_repository         = aws_ecr_repository.web.name
    board_domain           = var.domain_name
    acme_email             = var.acme_email
    auth_mode              = var.auth_mode
    container_mode         = var.enable_container_mode ? "1" : "0"
    enable_brew            = var.enable_brew ? "1" : "0"
    data_volume_id         = aws_ebs_volume.data.id
    swap_size_gb           = var.swap_size_gb
    compose_plugin_version = var.compose_plugin_version
  })
}
