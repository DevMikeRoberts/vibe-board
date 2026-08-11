#!/usr/bin/env bash
# Installs one channel of infra/deploy/toolbox.manifest.
#
#   install-toolbox.sh --channel apt|npm|brew [--manifest PATH] [--strict]
#
# Best-effort by design: a package that fails to install is reported and the
# run continues. A single renamed or yanked agent CLI should not break the
# image build or the boot — the board detects which agents are actually present
# at startup and reports the rest as unavailable, which is the honest outcome.
# Pass --strict to fail the run instead (useful in CI).
set -uo pipefail

CHANNEL=""
MANIFEST="$(dirname "$0")/toolbox.manifest"
STRICT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --channel)  CHANNEL="${2:-}"; shift 2 ;;
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --strict)   STRICT=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$CHANNEL" in
  apt|npm|brew) ;;
  *) echo "usage: $0 --channel apt|npm|brew [--manifest PATH] [--strict]" >&2; exit 2 ;;
esac

[ -f "$MANIFEST" ] || { echo "[toolbox] manifest not found: $MANIFEST" >&2; exit 1; }

log()  { echo "[toolbox] $*"; }
warn() { echo "[toolbox] WARNING: $*" >&2; }

# Collect this channel's entries up front so apt can install them in one
# transaction instead of one apt-get per package.
packages=()
binaries=()
while read -r channel package binary _rest; do
  case "$channel" in
    ''|\#*) continue ;;
  esac
  [ "$channel" = "$CHANNEL" ] || continue
  [ -n "$package" ] || continue
  packages+=("$package")
  binaries+=("${binary:-}")
done < <(sed 's/#.*//' "$MANIFEST")

if [ "${#packages[@]}" -eq 0 ]; then
  log "no '$CHANNEL' entries in $MANIFEST — nothing to do"
  exit 0
fi

log "installing ${#packages[@]} '$CHANNEL' package(s)"
failed=()

case "$CHANNEL" in
  apt)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq || warn "apt-get update failed; continuing with cached lists"
    # One transaction first — far faster. If it fails, fall back to installing
    # individually so one bad package name does not sink the rest.
    if ! apt-get install -y --no-install-recommends "${packages[@]}" >/dev/null; then
      warn "batch install failed, retrying individually"
      for pkg in "${packages[@]}"; do
        apt-get install -y --no-install-recommends "$pkg" >/dev/null \
          || { warn "apt package failed: $pkg"; failed+=("$pkg"); }
      done
    fi
    rm -rf /var/lib/apt/lists/*
    ;;

  npm)
    for pkg in "${packages[@]}"; do
      log "npm install -g $pkg"
      npm install -g --no-fund --no-audit "$pkg" \
        || { warn "npm package failed: $pkg"; failed+=("$pkg"); }
    done
    npm cache clean --force >/dev/null 2>&1 || true
    ;;

  brew)
    command -v brew >/dev/null 2>&1 || {
      warn "brew is not on PATH — skipping the brew channel (see install-brew.sh)"
      exit 0
    }
    for pkg in "${packages[@]}"; do
      log "brew install $pkg"
      brew install "$pkg" || { warn "brew formula failed: $pkg"; failed+=("$pkg"); }
    done
    ;;
esac

# Verify the binaries that were declared. A package that installs but does not
# put its binary on PATH is the failure mode that silently disables an agent,
# so it is called out loudly rather than left to be discovered at runtime.
missing_bin=()
for i in "${!packages[@]}"; do
  bin="${binaries[$i]}"
  [ -n "$bin" ] || continue
  if command -v "$bin" >/dev/null 2>&1; then
    log "  ok   $bin -> $(command -v "$bin")"
  else
    warn "  MISS $bin (from ${packages[$i]}) is not on PATH"
    missing_bin+=("$bin")
  fi
done

if [ "${#failed[@]}" -gt 0 ] || [ "${#missing_bin[@]}" -gt 0 ]; then
  [ "${#failed[@]}" -gt 0 ] && warn "failed to install: ${failed[*]}"
  [ "${#missing_bin[@]}" -gt 0 ] && warn "binaries not on PATH: ${missing_bin[*]}"
  if [ "$STRICT" -eq 1 ]; then
    echo "[toolbox] --strict set, failing" >&2
    exit 1
  fi
  log "continuing anyway (best-effort); the board will report affected agents as unavailable"
fi

log "channel '$CHANNEL' done"
