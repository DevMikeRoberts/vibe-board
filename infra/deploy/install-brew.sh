#!/usr/bin/env bash
# Bootstraps Homebrew for the agents, and installs the manifest's brew channel.
#
# Run from the server container's entrypoint when AGENTBOARD_ENABLE_BREW=1.
#
# Two decisions worth knowing about:
#
# 1. Homebrew is NOT baked into the image. It lives at the standard prefix
#    /home/linuxbrew/.linuxbrew, which the compose file bind-mounts from
#    /data/homebrew on the persistent EBS volume. So anything an agent installs
#    with `brew install` survives a redeploy and an instance replacement, and
#    the image stays small enough to pull onto a small root volume.
#
#    The standard prefix matters: at any other prefix Homebrew refuses to use
#    bottles and compiles every formula from source, which on a 1 GB instance
#    means an OOM instead of an install.
#
# 2. Homebrew refuses to run as root, so the image creates a `linuxbrew` user
#    and everything here runs as that user. Root can still execute the results,
#    because the prefix's bin directory is on PATH.
set -uo pipefail

BREW_USER="${BREW_USER:-linuxbrew}"
BREW_PREFIX="${BREW_PREFIX:-/home/linuxbrew/.linuxbrew}"
BREW_BIN="$BREW_PREFIX/bin/brew"
MANIFEST="${TOOLBOX_MANIFEST:-/opt/agentboard-toolbox/toolbox.manifest}"

log()  { echo "[brew] $*"; }
warn() { echo "[brew] WARNING: $*" >&2; }

if [ "${AGENTBOARD_ENABLE_BREW:-0}" != "1" ]; then
  log "AGENTBOARD_ENABLE_BREW is not 1 — skipping"
  exit 0
fi

id "$BREW_USER" >/dev/null 2>&1 || { warn "user $BREW_USER does not exist in this image"; exit 0; }

# The bind mount arrives owned by root; Homebrew needs its prefix writable.
mkdir -p /home/linuxbrew
chown -R "$BREW_USER:$BREW_USER" /home/linuxbrew 2>/dev/null || true

if [ -x "$BREW_BIN" ]; then
  log "already installed at $BREW_PREFIX (persisted from a previous run)"
else
  log "installing Homebrew into $BREW_PREFIX — first run only, this takes a few minutes"
  # NONINTERACTIVE keeps the installer from waiting on a TTY that is not there.
  if ! su - "$BREW_USER" -c \
      'NONINTERACTIVE=1 CI=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'; then
    warn "Homebrew install failed — continuing without it"
    exit 0
  fi
fi

[ -x "$BREW_BIN" ] || { warn "brew still not present at $BREW_BIN after install"; exit 0; }

# Keep it lean and quiet on a small box.
export HOMEBREW_NO_ANALYTICS=1
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1

if [ -f "$MANIFEST" ]; then
  log "installing the manifest's brew channel"
  su - "$BREW_USER" -c \
    "HOMEBREW_NO_ANALYTICS=1 HOMEBREW_NO_AUTO_UPDATE=1 PATH=$BREW_PREFIX/bin:\$PATH \
     bash '$(dirname "$0")/install-toolbox.sh' --channel brew --manifest '$MANIFEST'" \
    || warn "one or more brew formulae failed; continuing"
else
  log "no manifest at $MANIFEST — skipping the brew channel"
fi

log "ready: $("$BREW_BIN" --version 2>/dev/null | head -1)"
