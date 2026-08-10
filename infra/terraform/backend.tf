# Remote state. Left commented so the very first `terraform init` works with no
# prerequisites; run infra/scripts/bootstrap-tf-state.sh, uncomment, and re-run
# `terraform init -migrate-state` once you want state shared with CI.
#
# `use_lockfile` is S3-native locking (Terraform >= 1.10) — no DynamoDB table,
# so state costs a few cents a month at most.
#
# terraform {
#   backend "s3" {
#     bucket       = "agentboard-tfstate-<suffix>"
#     key          = "prod/terraform.tfstate"
#     region       = "us-east-1"
#     encrypt      = true
#     use_lockfile = true
#   }
# }
