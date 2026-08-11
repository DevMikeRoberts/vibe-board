#!/usr/bin/env bash
# One-time teardown of the resources orphaned by Terraform (infra) run 31450993251.
#
# That run created 41 AWS resources and then threw its state away, because
# backend.tf declared no `backend "s3"` block and Terraform silently fell back
# to local state on the runner. Nothing tracks these resources, so `terraform
# destroy` cannot reach them — they have to be deleted by ID.
#
# Every ID below is copied from that run's log. The script touches nothing else:
# there is no tag sweep, no wildcard, no "delete everything in the VPC". If a
# resource is already gone, its step is skipped.
#
# Dry run (prints what it would delete, changes nothing):
#   ./teardown-orphans.sh
#
# For real:
#   ./teardown-orphans.sh --yes
#
# NOT deleted: the Terraform state bucket agentboard-tfstate-880255526061.
# The fixed backend needs it.

set -uo pipefail

ACCOUNT_ID="880255526061"
REGION="us-east-1"

INSTANCE_ID="i-0ca5ef56ddf86b08a"
EIP_ALLOC="eipalloc-03304f1b296c9a4d7"
VOLUME_ID="vol-0c24b5d0805c449bf"
SG_ID="sg-05c1cb9eb60ad7c15"
RTB_ASSOC="rtbassoc-06ad840222727a93d"
RTB_ID="rtb-04eca0648d63ecbd3"
SUBNET_ID="subnet-0cf6fe5b571e57c1c"
IGW_ID="igw-08a620587703f3092"
VPC_ID="vpc-0a4e9983a58b1fa65"
DEPLOY_BUCKET="agentboard-prod-deploy-d823f0dd"
ECR_REPOS=(agentboard-prod/server agentboard-prod/web)
SSM_PARAMS=(
  /agentboard/prod/ANTHROPIC_API_KEY
  /agentboard/prod/API_KEY
  /agentboard/prod/BASIC_AUTH_HASH
  /agentboard/prod/BASIC_AUTH_USER
  /agentboard/prod/CLAUDE_MODEL
  /agentboard/prod/GH_TOKEN
  /agentboard/prod/OAUTH2_PROXY_CLIENT_ID
  /agentboard/prod/OAUTH2_PROXY_CLIENT_SECRET
  /agentboard/prod/OAUTH2_PROXY_COOKIE_SECRET
  /agentboard/prod/OAUTH2_PROXY_GITHUB_USER
)
INSTANCE_PROFILE="agentboard-prod-instance"
INSTANCE_ROLE="agentboard-prod-instance"
DEPLOY_ROLE="agentboard-prod-github-deploy"
SSM_MANAGED_POLICY="arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
OIDC_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

# Set to 0 to keep the GitHub OIDC provider. It is account-wide rather than
# stack-scoped: if anything else in this account has started authenticating
# through it since 2026-08-11, deleting it breaks that too. Run 31450993251
# created it, so nothing predating that run can depend on it.
DELETE_OIDC_PROVIDER=1

DRY_RUN=1
[ "${1:-}" = "--yes" ] && DRY_RUN=0

export AWS_DEFAULT_REGION="$REGION"

if [ "$DRY_RUN" = "1" ]; then
  echo "=== DRY RUN — nothing will be deleted. Re-run with --yes to execute. ==="
else
  echo "=== DELETING — this is not a drill. ==="
fi
echo

actual_account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)"
if [ "$actual_account" != "$ACCOUNT_ID" ]; then
  echo "ABORT: credentials are for account '${actual_account:-<none>}', expected $ACCOUNT_ID." >&2
  exit 1
fi
echo "Account $ACCOUNT_ID confirmed, region $REGION."
echo

# Runs a command, or prints it in dry-run mode. Never aborts the script: these
# resources may have been cleaned up by hand already, and a missing one is a
# success, not an error.
run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "  would run: $*"
    return 0
  fi
  echo "  \$ $*"
  "$@" 2>&1 | sed 's/^/    /'
  return 0
}

step() { echo; echo "--- $* ---"; }

step "1/12  EC2 instance $INSTANCE_ID"
# Terminating also drops the EIP association, the ENI, and the data volume's
# attachment, so it has to happen before the volume, SG and subnet.
run aws ec2 terminate-instances --instance-ids "$INSTANCE_ID"
if [ "$DRY_RUN" = "0" ]; then
  echo "  waiting for termination (up to ~5 min)..."
  aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID" 2>/dev/null \
    && echo "    terminated" || echo "    (already gone or wait timed out — continuing)"
fi

step "2/12  Elastic IP $EIP_ALLOC"
run aws ec2 release-address --allocation-id "$EIP_ALLOC"

step "3/12  EBS data volume $VOLUME_ID"
if [ "$DRY_RUN" = "0" ]; then
  aws ec2 wait volume-available --volume-ids "$VOLUME_ID" 2>/dev/null || true
fi
run aws ec2 delete-volume --volume-id "$VOLUME_ID"

step "4/12  Security group $SG_ID"
# Its three ingress rules and one egress rule go with it.
run aws ec2 delete-security-group --group-id "$SG_ID"

step "5/12  Route table $RTB_ID"
run aws ec2 disassociate-route-table --association-id "$RTB_ASSOC"
run aws ec2 delete-route-table --route-table-id "$RTB_ID"

step "6/12  Subnet $SUBNET_ID"
run aws ec2 delete-subnet --subnet-id "$SUBNET_ID"

step "7/12  Internet gateway $IGW_ID"
run aws ec2 detach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
run aws ec2 delete-internet-gateway --internet-gateway-id "$IGW_ID"

step "8/12  VPC $VPC_ID"
run aws ec2 delete-vpc --vpc-id "$VPC_ID"

step "9/12  S3 deploy bucket $DEPLOY_BUCKET"
# Versioning was enabled, so every object version and delete marker has to go
# before the bucket will delete. Expected to be empty — nothing was ever
# deployed — but handled properly regardless.
if [ "$DRY_RUN" = "1" ]; then
  echo "  would purge all object versions + delete markers, then delete the bucket"
else
  while :; do
    payload="$(aws s3api list-object-versions --bucket "$DEPLOY_BUCKET" \
      --max-items 500 \
      --query '{Objects: (Versions||`[]`)[].{Key:Key,VersionId:VersionId}}' \
      --output json 2>/dev/null)"
    [ -z "$payload" ] && break
    count="$(echo "$payload" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("Objects") or []))' 2>/dev/null || echo 0)"
    [ "$count" = "0" ] && break
    echo "    deleting $count object version(s)"
    aws s3api delete-objects --bucket "$DEPLOY_BUCKET" --delete "$payload" >/dev/null 2>&1 || break
  done
  while :; do
    payload="$(aws s3api list-object-versions --bucket "$DEPLOY_BUCKET" \
      --max-items 500 \
      --query '{Objects: (DeleteMarkers||`[]`)[].{Key:Key,VersionId:VersionId}}' \
      --output json 2>/dev/null)"
    [ -z "$payload" ] && break
    count="$(echo "$payload" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("Objects") or []))' 2>/dev/null || echo 0)"
    [ "$count" = "0" ] && break
    echo "    deleting $count delete marker(s)"
    aws s3api delete-objects --bucket "$DEPLOY_BUCKET" --delete "$payload" >/dev/null 2>&1 || break
  done
fi
run aws s3api delete-bucket --bucket "$DEPLOY_BUCKET"

step "10/12  ECR repositories"
for repo in "${ECR_REPOS[@]}"; do
  run aws ecr delete-repository --repository-name "$repo" --force
done

step "11/12  SSM parameters (10)"
run aws ssm delete-parameters --names "${SSM_PARAMS[@]}"

step "12/12  IAM"
run aws iam remove-role-from-instance-profile \
  --instance-profile-name "$INSTANCE_PROFILE" --role-name "$INSTANCE_ROLE"
run aws iam delete-instance-profile --instance-profile-name "$INSTANCE_PROFILE"

run aws iam delete-role-policy --role-name "$INSTANCE_ROLE" --policy-name "$INSTANCE_ROLE"
run aws iam detach-role-policy --role-name "$INSTANCE_ROLE" --policy-arn "$SSM_MANAGED_POLICY"
run aws iam delete-role --role-name "$INSTANCE_ROLE"

run aws iam delete-role-policy --role-name "$DEPLOY_ROLE" --policy-name "$DEPLOY_ROLE"
run aws iam delete-role --role-name "$DEPLOY_ROLE"

if [ "$DELETE_OIDC_PROVIDER" = "1" ]; then
  run aws iam delete-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN"
else
  echo "  skipping the OIDC provider (DELETE_OIDC_PROVIDER=0)"
  echo "  -> set create_github_oidc_provider = false before the next apply,"
  echo "     or Terraform will fail trying to recreate it."
fi

echo
if [ "$DRY_RUN" = "1" ]; then
  echo "=== Dry run complete. Re-run with --yes to delete. ==="
else
  echo "=== Teardown complete. ==="
  echo
  echo "Verify nothing is left:"
  echo "  aws ec2 describe-instances --instance-ids $INSTANCE_ID --query 'Reservations[].Instances[].State.Name'"
  echo "  aws ec2 describe-vpcs --vpc-ids $VPC_ID"
  echo "  aws iam list-roles --query \"Roles[?starts_with(RoleName,'agentboard-prod')].RoleName\""
  echo
  echo "Then merge PR #43 and dispatch Terraform (infra) with action=apply."
fi
