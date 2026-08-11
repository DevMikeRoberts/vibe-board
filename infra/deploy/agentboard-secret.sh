#!/usr/bin/env bash
# Set or rotate a runtime secret from a shell on the instance, out of band —
# never through git, CI logs, or Terraform state.
#
#   agentboard-secret list
#   agentboard-secret set ANTHROPIC_API_KEY      # prompts, input hidden
#   agentboard-secret set ANTHROPIC_API_KEY --stdin < key.txt
#   agentboard-secret apply                      # re-render env + restart
#
# Get a shell with:  aws ssm start-session --target <instance-id>  then  sudo -i
#
# The value is read from a hidden prompt or stdin, never from the command line,
# so it does not land in shell history, `ps` output, or the SSM command log. It
# is written to SSM Parameter Store as a SecureString; deploy.sh re-renders the
# per-service env files from there and restarts the stack.
set -euo pipefail

# shellcheck disable=SC1091
. /etc/agentboard/instance.env

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

# Secrets the stack actually reads. Anything else is almost certainly a typo,
# and a typo here fails silently at deploy time, so refuse it up front.
KNOWN_SECRETS="API_KEY ANTHROPIC_API_KEY GH_TOKEN BASIC_AUTH_HASH OAUTH2_PROXY_CLIENT_SECRET OAUTH2_PROXY_COOKIE_SECRET"
KNOWN_PLAIN="BASIC_AUTH_USER OAUTH2_PROXY_CLIENT_ID OAUTH2_PROXY_GITHUB_USER CLAUDE_MODEL"

cmd_list() {
  echo "Parameters under $SSM_PREFIX (values are never printed):"
  aws ssm get-parameters-by-path --path "$SSM_PREFIX" --recursive \
    --region "$AWS_REGION" --output json |
    jq -r '.Parameters[] | "\(.Name | split("/") | last)\t\(.Type)\t\(if .Value == "REPLACE_ME" then "NOT SET" else "set" end)"' |
    sort | column -t -s $'\t'
}

cmd_set() {
  local name="${1:-}"; shift || true
  [ -n "$name" ] || { echo "error: missing parameter name" >&2; usage 2; }

  local type="SecureString"
  if [[ " $KNOWN_PLAIN " == *" $name "* ]]; then
    type="String"
  elif [[ " $KNOWN_SECRETS " != *" $name "* ]]; then
    echo "error: '$name' is not a parameter this stack reads." >&2
    echo "  secrets: $KNOWN_SECRETS" >&2
    echo "  plain:   $KNOWN_PLAIN" >&2
    exit 2
  fi

  local value=""
  if [ "${1:-}" = "--stdin" ]; then
    IFS= read -r value
  else
    # -s keeps it off the screen; the value never appears in argv either way.
    read -r -s -p "Value for $name (input hidden): " value
    echo
  fi

  [ -n "$value" ] || { echo "error: empty value, nothing written" >&2; exit 1; }

  aws ssm put-parameter --name "$SSM_PREFIX/$name" --type "$type" \
    --value "$value" --overwrite --region "$AWS_REGION" >/dev/null
  unset value

  echo "Wrote $SSM_PREFIX/$name."
  echo "Run 'agentboard-secret apply' to load it into the running stack."
}

# Re-runs the current release: re-renders the env files from Parameter Store and
# restarts the containers. No image pull, so it is quick and cannot change the
# deployed version.
cmd_apply() {
  echo "Re-rendering environment from $SSM_PREFIX and restarting..."
  /usr/local/bin/agentboard-deploy
}

case "${1:-}" in
  list)  shift; cmd_list "$@" ;;
  set)   shift; cmd_set "$@" ;;
  apply) shift; cmd_apply "$@" ;;
  -h|--help|"") usage 0 ;;
  *) echo "unknown command: $1" >&2; usage 2 ;;
esac
