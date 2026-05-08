#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

run_step() {
  name="$1"
  shift
  echo "==> $name"
  "$@"
}

run_step "Build client" npm run build:client
run_step "Build server" npm run build:server
run_step "Run required E2E tests" npm run test:e2e:required
