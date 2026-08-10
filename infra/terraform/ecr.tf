# Images live in ECR rather than a public registry so nothing on the instance
# holds a long-lived registry credential: CI pushes with its OIDC role, the
# instance pulls with its instance profile. Pulls are in-region, so image data
# transfer is free.

resource "aws_ecr_repository" "server" {
  name                 = "${local.name_prefix}/server"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "web" {
  name                 = "${local.name_prefix}/web"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Storage is the only ECR cost, so keep the tail short: a handful of tagged
# images for rollback, and untagged layers gone the next day.
locals {
  ecr_lifecycle_policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        # `any` must be the last rule; it caps total images kept per repository,
        # which is what bounds the storage bill.
        rulePriority = 2
        description  = "Keep only the most recent ${var.ecr_image_retention_count} images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.ecr_image_retention_count
        }
        action = { type = "expire" }
      },
    ]
  })
}

resource "aws_ecr_lifecycle_policy" "server" {
  repository = aws_ecr_repository.server.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name
  policy     = local.ecr_lifecycle_policy
}
