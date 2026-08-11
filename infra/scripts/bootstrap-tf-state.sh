#!/usr/bin/env bash
# One-time creation of the S3 bucket that holds Terraform state.
#
# State locking uses S3 conditional writes (Terraform >= 1.10), so there is no
# DynamoDB table to create or pay for. Run this before uncommenting the backend
# block in infra/terraform/backend.tf.
#
#   ./infra/scripts/bootstrap-tf-state.sh [bucket-name] [region]
set -euo pipefail

REGION="${2:-${AWS_REGION:-us-east-1}}"
BUCKET="${1:-agentboard-tfstate-$(aws sts get-caller-identity --query Account --output text)}"

echo "Creating state bucket '$BUCKET' in $REGION"

if [ "$REGION" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION"
fi

aws s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'

cat <<MSG

Done. Now uncomment the backend block in infra/terraform/backend.tf with:

  bucket       = "$BUCKET"
  key          = "prod/terraform.tfstate"
  region       = "$REGION"
  encrypt      = true
  use_lockfile = true

then run: terraform init -migrate-state
MSG
