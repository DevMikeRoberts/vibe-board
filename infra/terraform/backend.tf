# Remote state. The block must be declared even though every value is supplied
# at init time: `-backend-config` is ignored when there is no `backend` block,
# and Terraform falls back to local state with only a warning. On a CI runner
# that state is discarded with the job, orphaning everything the apply created.
#
# The infra workflow creates the bucket and passes all five settings, so nothing
# here needs to name them. To init locally, pass the same flags:
#
#   terraform init \
#     -backend-config="bucket=agentboard-tfstate-<account-id>" \
#     -backend-config="key=prod/terraform.tfstate" \
#     -backend-config="region=us-east-1" \
#     -backend-config="encrypt=true" \
#     -backend-config="use_lockfile=true"
#
# `use_lockfile` is S3-native locking (Terraform >= 1.10) — no DynamoDB table,
# so state costs a few cents a month at most.
terraform {
  backend "s3" {}
}
