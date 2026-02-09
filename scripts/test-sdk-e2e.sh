#!/usr/bin/env bash
#
# End-to-end test for the Copilot SDK agent via the REST API.
# Tests both non-worktree and worktree flows.
#
# Usage:
#   ./scripts/test-sdk-e2e.sh [--repo /path/to/repo] [--no-worktree] [--worktree-only]
#
# Requirements:
#   - Server running on localhost:3001
#   - GitHub Copilot CLI installed and authenticated
#   - Target repo must be a git repository with a clean working tree
#

set -euo pipefail

API="http://localhost:3001/api"
REPO="/root/projects/upload-download-app"
BASE_BRANCH="master"
POLL_INTERVAL=3
TIMEOUT=120
RUN_NO_WT=true
RUN_WT=true

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case $1 in
    --repo)        REPO="$2"; shift 2 ;;
    --base-branch) BASE_BRANCH="$2"; shift 2 ;;
    --no-worktree) RUN_WT=false; RUN_NO_WT=true; shift ;;
    --worktree-only) RUN_NO_WT=false; RUN_WT=true; shift ;;
    --timeout)     TIMEOUT="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--repo PATH] [--base-branch BRANCH] [--no-worktree] [--worktree-only] [--timeout SECS]"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Helpers ---
step() { echo -e "\n${CYAN}▸ $1${NC}"; }
pass() { echo -e "  ${GREEN}✓ $1${NC}"; }
fail() { echo -e "  ${RED}✗ $1${NC}"; }
info() { echo -e "  ${DIM}$1${NC}"; }

check_server() {
  if ! curl -sf "$API/../api/health" > /dev/null 2>&1; then
    echo -e "${RED}Error: Server not responding at $API${NC}"
    echo "Start the server first: cd packages/server && npx tsx src/index.ts"
    exit 1
  fi
}

create_task() {
  local title="$1" desc="$2"
  curl -sf -X POST "$API/tasks" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"$title\",\"description\":\"$desc\",\"priority\":\"medium\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])"
}

configure_task() {
  local id="$1"; shift
  curl -sf -X POST "$API/tasks/$id/configure" \
    -H "Content-Type: application/json" \
    -d "$@" > /dev/null
}

move_task() {
  local id="$1" col="$2"
  curl -sf -X PATCH "$API/tasks/$id" \
    -H "Content-Type: application/json" \
    -d "{\"columnId\":\"$col\"}" > /dev/null
}

run_agent() {
  local id="$1"
  curl -sf -X POST "$API/tasks/$id/run" > /dev/null
}

get_task_field() {
  local id="$1" field="$2"
  curl -sf "$API/tasks" | python3 -c "
import json,sys
for t in json.load(sys.stdin):
    if t['id'] == '$id':
        print(t.get('$field',''))
        break
"
}

get_event_count() {
  local id="$1"
  curl -sf "$API/tasks/$id/events" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"
}

get_events_summary() {
  local id="$1"
  curl -sf "$API/tasks/$id/events" | python3 -c "
import json,sys
events = json.load(sys.stdin)
types = {}
for e in events:
    types[e['type']] = types.get(e['type'], 0) + 1
parts = [f'{v} {k}' for k,v in sorted(types.items())]
print(', '.join(parts))
"
}

wait_for_complete() {
  local id="$1" elapsed=0
  while [ $elapsed -lt $TIMEOUT ]; do
    local status
    status=$(get_task_field "$id" "agentStatus")
    local count
    count=$(get_event_count "$id")
    printf "\r  ${DIM}⏳ %ds — status: %s, events: %s${NC}   " "$elapsed" "$status" "$count"
    if [ "$status" = "complete" ]; then
      printf "\r"
      return 0
    fi
    if [ "$status" = "failed" ]; then
      printf "\r"
      return 1
    fi
    sleep "$POLL_INTERVAL"
    elapsed=$((elapsed + POLL_INTERVAL))
  done
  printf "\r"
  return 1
}

cleanup_repo() {
  cd "$REPO" && git checkout -- . 2>/dev/null && git worktree prune 2>/dev/null
}

# --- Pre-flight ---
echo -e "${BOLD}Copilot SDK E2E Test${NC}"
echo -e "${DIM}Repo: $REPO | Timeout: ${TIMEOUT}s${NC}"
check_server
pass "Server healthy"

if ! [ -d "$REPO/.git" ]; then
  echo -e "${RED}Error: $REPO is not a git repository${NC}"
  exit 1
fi
pass "Repo exists"

PASSED=0
FAILED=0
TS=$(date +%s)

# ============================================================
# TEST 1: Without worktree
# ============================================================
if $RUN_NO_WT; then
  echo -e "\n${BOLD}━━━ Test 1: Agent without worktree ━━━${NC}"
  cleanup_repo

  step "Creating task"
  TASK_ID=$(create_task "SDK Test $TS" "Add a comment at the top of README.md: <!-- sdk-test-$TS -->")
  info "Task ID: $TASK_ID"

  step "Configuring repo (no worktree)"
  configure_task "$TASK_ID" "{\"repoPath\":\"$REPO\",\"useWorktree\":false}"
  pass "Configured"

  step "Moving to in-progress"
  move_task "$TASK_ID" "in-progress"
  pass "Moved"

  step "Running agent"
  run_agent "$TASK_ID"
  info "Agent started, polling for completion..."

  if wait_for_complete "$TASK_ID"; then
    pass "Agent completed"
  else
    fail "Agent did not complete within ${TIMEOUT}s"
    FAILED=$((FAILED + 1))
    echo -e "\n${BOLD}━━━ Test 1: ${RED}FAILED${NC} ${BOLD}━━━${NC}"
  fi

  if [ $FAILED -eq 0 ]; then
    step "Verifying results"
    COL=$(get_task_field "$TASK_ID" "columnId")
    STATUS=$(get_task_field "$TASK_ID" "agentStatus")
    EVENTS=$(get_events_summary "$TASK_ID")

    [ "$COL" = "review" ] && pass "Task moved to review" || fail "Expected column=review, got $COL"
    [ "$STATUS" = "complete" ] && pass "Status is complete" || fail "Expected status=complete, got $STATUS"
    info "Events: $EVENTS"

    # Check that repo was modified
    cd "$REPO"
    if ! git diff --quiet HEAD; then
      pass "Agent made changes to repo"
    else
      fail "No changes detected in repo"
    fi

    step "Cleaning up"
    cleanup_repo
    pass "Repo restored"

    echo -e "\n${BOLD}━━━ Test 1: ${GREEN}PASSED${NC} ${BOLD}━━━${NC}"
    PASSED=$((PASSED + 1))
  fi
fi

# ============================================================
# TEST 2: With worktree
# ============================================================
if $RUN_WT; then
  echo -e "\n${BOLD}━━━ Test 2: Agent with worktree isolation ━━━${NC}"
  cleanup_repo
  BRANCH="e2e-wt-$TS"

  step "Creating task"
  TASK_ID=$(create_task "SDK Worktree Test $TS" "Add a comment at the top of README.md: <!-- worktree-test-$TS -->")
  info "Task ID: $TASK_ID"

  step "Configuring repo (with worktree)"
  configure_task "$TASK_ID" "{\"repoPath\":\"$REPO\",\"useWorktree\":true,\"branchName\":\"$BRANCH\",\"baseBranch\":\"$BASE_BRANCH\"}"
  pass "Configured with branch $BRANCH"

  step "Moving to in-progress"
  move_task "$TASK_ID" "in-progress"
  pass "Moved"

  step "Running agent"
  run_agent "$TASK_ID"
  info "Agent started, polling for completion..."

  FAILED_WT=0
  if wait_for_complete "$TASK_ID"; then
    pass "Agent completed"
  else
    fail "Agent did not complete within ${TIMEOUT}s"
    FAILED_WT=1
  fi

  if [ $FAILED_WT -eq 0 ]; then
    step "Verifying isolation"
    EVENTS=$(get_events_summary "$TASK_ID")
    info "Events: $EVENTS"

    # Main repo should be clean
    cd "$REPO"
    if git diff --quiet HEAD; then
      pass "Main repo is clean (no changes leaked)"
    else
      fail "Main repo has changes — isolation broken!"
      git diff --stat HEAD
      FAILED_WT=1
    fi

    # Worktree should have changes
    WT_PATH=$(get_task_field "$TASK_ID" "worktreePath")
    if [ -n "$WT_PATH" ] && [ -d "$WT_PATH" ]; then
      cd "$WT_PATH"
      if ! git diff --quiet HEAD; then
        pass "Worktree has changes at $WT_PATH"
      else
        fail "Worktree has no changes"
        FAILED_WT=1
      fi
    else
      fail "Worktree path not found: $WT_PATH"
      FAILED_WT=1
    fi

    step "Cleaning up worktree"
    curl -sf -X POST "$API/tasks/$TASK_ID/cleanup-worktree" > /dev/null 2>&1 || true
    cd "$REPO" && git worktree prune 2>/dev/null
    git branch -D "$BRANCH" 2>/dev/null || true
    pass "Cleaned up"
  fi

  if [ $FAILED_WT -eq 0 ]; then
    echo -e "\n${BOLD}━━━ Test 2: ${GREEN}PASSED${NC} ${BOLD}━━━${NC}"
    PASSED=$((PASSED + 1))
  else
    echo -e "\n${BOLD}━━━ Test 2: ${RED}FAILED${NC} ${BOLD}━━━${NC}"
    FAILED=$((FAILED + 1))
  fi
fi

# ============================================================
# Summary
# ============================================================
echo ""
TOTAL=$((PASSED + FAILED))
if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All $TOTAL tests passed ✓${NC}"
else
  echo -e "${RED}${BOLD}$FAILED/$TOTAL tests failed ✗${NC}"
  exit 1
fi
