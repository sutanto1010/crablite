#!/usr/bin/env bash
#
# crablite updater for system installs (e.g. /opt/crablite).
#
# Wraps the GitHub Releases download + atomic install so you don't hit
# "Text file busy (ETXTBSY)" when replacing a running binary:
# the new binary is written to a temp file in the same directory and
# renamed over the old one (rename swaps inodes, in-place overwrite does not).
#
# Usage:
#   sudo ./update.sh [--dir /opt/crablite] [--yes] [--check-only]
#   sudo ./update.sh --dir /opt/crablite --version 26.11.15
#   curl -fsSL https://github.com/sutanto1010/crablite/releases/latest/download/update.sh | sudo bash -s -- --dir /opt/crablite --yes
#
# Inside Docker use `docker pull` instead of this script.

set -euo pipefail

REPO="${CRABLITE_REPO:-sutanto1010/crablite}"
INSTALL_DIR=""
VERSION_PIN=""
YES=false
CHECK_ONLY=false
NO_RESTART=false
SERVICE_NAME="${CRABLITE_SERVICE:-crablite}"

usage() {
  cat <<'EOF'
Usage: update.sh [options]

Options:
  -d, --dir DIR        Install directory containing `crablite` + `dist/`
                       (default: /opt/crablite if it exists, else current directory)
  --version X.Y.Z      Install a specific version instead of latest
  --tag vX.Y.Z         Same as --version but accepts the git tag form
  -y, --yes            Skip the confirmation prompt
  --check-only         Only check for a newer release (exit 10 = update available)
  --no-restart         Do not restart the systemd service after install
  --service NAME       systemd unit to restart (default: crablite, empty disables)
  --repo OWNER/REPO    Override GitHub repo (default: sutanto1010/crablite)
  -h, --help           Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --version) VERSION_PIN="${2:-}"; shift 2 ;;
    --tag) VERSION_PIN="${2:-}"; VERSION_PIN="${VERSION_PIN#v}"; shift 2 ;;
    -y|--yes) YES=true; shift ;;
    --check-only) CHECK_ONLY=true; shift ;;
    --no-restart) NO_RESTART=true; shift ;;
    --service) SERVICE_NAME="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command not found: $1" >&2
    exit 1
  fi
}
need_cmd curl
need_cmd tar
need_cmd uname
need_cmd mktemp

# --- Detect platform -> release asset target triple (mirrors backend pick_asset) ---
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Linux) OS_ID="linux" ;;
  Darwin) OS_ID="macos" ;;
  MINGW*|MSYS*|CYGWIN*) echo "Error: run the .zip asset update on Windows, not this script." >&2; exit 1 ;;
  *) echo "Error: unsupported OS: $OS" >&2; exit 1 ;;
esac
case "$ARCH" in
  x86_64|amd64) ARCH_ID="x86_64" ;;
  aarch64|arm64) ARCH_ID="aarch64" ;;
  *) echo "Error: unsupported arch: $ARCH" >&2; exit 1 ;;
esac
case "$OS_ID-$ARCH_ID" in
  linux-x86_64) TARGET="x86_64-unknown-linux-musl" ;;
  linux-aarch64) TARGET="aarch64-unknown-linux-musl" ;;
  macos-aarch64) TARGET="aarch64-apple-darwin" ;;
  macos-x86_64) TARGET="x86_64-apple-darwin" ;;
  *) echo "Error: unsupported platform: $OS/$ARCH" >&2; exit 1 ;;
esac

# --- Resolve install dir ---
if [[ -z "$INSTALL_DIR" ]]; then
  if [[ -x "/opt/crablite/crablite" ]]; then
    INSTALL_DIR="/opt/crablite"
  elif [[ -x "./crablite" ]]; then
    INSTALL_DIR="."
  else
    INSTALL_DIR="/opt/crablite"
  fi
fi
# Canonicalize without requiring the dir to exist yet.
INSTALL_DIR="$(cd "$INSTALL_DIR" 2>/dev/null && pwd || echo "$INSTALL_DIR")"
BIN="$INSTALL_DIR/crablite"
DIST="$INSTALL_DIR/dist"

CURRENT_VERSION="0.0.0"
if [[ -x "$BIN" ]]; then
  # `crablite --version` prints e.g. `crablite 26.11.14`
  CURRENT_VERSION="$("$BIN" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
  [[ -z "$CURRENT_VERSION" ]] && CURRENT_VERSION="0.0.0"
fi

# --- Resolve release metadata ---
API_BASE="https://api.github.com/repos/${REPO}"
if [[ -n "$VERSION_PIN" ]]; then
  TAG="v${VERSION_PIN#v}"
  RELEASE_JSON="$(curl -fsSL -H "Accept: application/vnd.github+json" -H "User-Agent: crablite-update-sh/1" "$API_BASE/releases/tags/$TAG")"
else
  RELEASE_JSON="$(curl -fsSL -H "Accept: application/vnd.github+json" -H "User-Agent: crablite-update-sh/1" "$API_BASE/releases/latest")"
fi

json_get() {
  # $1 = python expression over parsed JSON read from stdin; falls back to grep when python3 is missing.
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"
  else
    grep -oE '"tag_name": *"[^"]+"' | head -n1 | cut -d'"' -f4
  fi
}

LATEST_TAG="$(printf '%s' "$RELEASE_JSON" | json_get "d.get('tag_name','')")"
LATEST_VERSION="${LATEST_TAG#v}"
if [[ -z "$LATEST_VERSION" ]]; then
  echo "Error: could not determine latest version from GitHub API." >&2
  exit 1
fi

ver_greater() {
  # returns 0 if $1 > $2 (numeric dot-separated compare)
  local a="$1" b="$2"
  local IFS=.
  read -ra AV <<< "$a"
  read -ra BV <<< "$b"
  local len=${#AV[@]}; [[ ${#BV[@]} -gt $len ]] && len=${#BV[@]}
  for ((i=0; i<len; i++)); do
    local x="${AV[i]:-0}" y="${BV[i]:-0}"
    x="${x%%[^0-9]*}"; y="${y%%[^0-9]*}"
    [[ -z "$x" ]] && x=0; [[ -z "$y" ]] && y=0
    if (( 10#$x > 10#$y )); then return 0; fi
    if (( 10#$x < 10#$y )); then return 1; fi
  done
  return 1
}

echo "Current version: $CURRENT_VERSION"
echo "Latest version: $LATEST_VERSION ($LATEST_TAG)"

if ! ver_greater "$LATEST_VERSION" "$CURRENT_VERSION"; then
  echo "Already up to date."
  exit 0
fi

# Find the download URL for our TARGET without requiring jq.
ASSET_URL=""
ASSET_NAME=""
if command -v python3 >/dev/null 2>&1; then
  read -r ASSET_NAME ASSET_URL <<< "$(printf '%s' "$RELEASE_JSON" | TARGET="$TARGET" python3 -c "
import json,os,sys
d=json.load(sys.stdin)
t=os.environ['TARGET']
for a in d.get('assets',[]):
    n=a.get('name','')
    if t in n:
        print(n, a.get('browser_download_url',''))
        break
")"
else
  # Fallback: best-effort grep for tarball URLs containing TARGET.
  ASSET_URL="$(printf '%s' "$RELEASE_JSON" | grep -oE '"browser_download_url": *"[^"]*'"$TARGET"'[^"]*\.tar\.gz"' | head -n1 | cut -d'"' -f4)"
  ASSET_NAME="$(basename "$ASSET_URL")"
fi
if [[ -z "$ASSET_URL" ]]; then
  echo "Error: no asset for $TARGET in $LATEST_TAG. Available:" >&2
  printf '%s' "$RELEASE_JSON" | grep -oE '"name": *"crablite[^"]*"' | head -n20 >&2 || true
  exit 1
fi
echo "Found asset: $ASSET_NAME"

if [[ "$CHECK_ONLY" == true ]]; then
  echo "Update available: $CURRENT_VERSION -> $LATEST_VERSION"
  exit 10
fi

if [[ "$YES" != true ]]; then
  printf 'Proceed with update %s -> %s in %s? [y/N] ' "$CURRENT_VERSION" "$LATEST_VERSION" "$INSTALL_DIR"
  read -r reply || reply=""
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi

if [[ ! -d "$INSTALL_DIR" ]]; then
  echo "Error: install directory not found: $INSTALL_DIR (use --dir DIR)" >&2
  exit 1
fi
if [[ ! -w "$INSTALL_DIR" ]]; then
  echo "Error: no write permission for $INSTALL_DIR — re-run with sudo." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "Downloading $ASSET_NAME ..."
curl -fSL --retry 3 -H "User-Agent: crablite-update-sh/1" -o "$WORK/$ASSET_NAME" "$ASSET_URL"
echo "Extracting ..."
tar -xzf "$WORK/$ASSET_NAME" -C "$WORK"

# Archives contain top-level crablite-v<V>-<TARGET>/ with binary + dist/.
PKG_ROOT="$(find "$WORK" -maxdepth 2 -name dist -type d -print -quit | xargs dirname 2>/dev/null || true)"
[[ -z "$PKG_ROOT" ]] && PKG_ROOT="$WORK"
NEW_BIN="$PKG_ROOT/crablite"
NEW_DIST="$PKG_ROOT/dist"
[[ -x "$NEW_BIN" ]] || { echo "Error: extracted package has no binary (looked in $PKG_ROOT)" >&2; exit 1; }
[[ -d "$NEW_DIST" ]] || { echo "Error: extracted package has no dist/ (looked in $PKG_ROOT)" >&2; exit 1; }

SERVICE_WAS_ACTIVE=false
if [[ "$NO_RESTART" != true && -n "$SERVICE_NAME" ]] && command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    SERVICE_WAS_ACTIVE=true
  fi
fi

echo "Installing binary to $BIN ..."
cp -f "$NEW_BIN" "$WORK/crablite.new"
chmod 755 "$WORK/crablite.new"
if [[ -f "$BIN" ]]; then
  cp -f "$BIN" "$BIN.bak" || echo "Warning: could not write $BIN.bak" >&2
fi
# Atomic swap: rename works even while the old binary is running (avoids ETXTBSY).
mv -f "$WORK/crablite.new" "$BIN"
chmod 755 "$BIN"

echo "Installing WebUI to $DIST ..."
if [[ -d "$DIST" ]]; then
  rm -rf "$DIST.bak"
  mv "$DIST" "$DIST.bak"
fi
mkdir -p "$DIST"
cp -R "$NEW_DIST/." "$DIST/"
rm -rf "$DIST.bak"

if [[ "$SERVICE_WAS_ACTIVE" == true ]]; then
  echo "Restarting systemd service: $SERVICE_NAME ..."
  systemctl restart "$SERVICE_NAME"
  systemctl is-active --quiet "$SERVICE_NAME" && echo "Service $SERVICE_NAME is active." || echo "Warning: $SERVICE_NAME did not become active — check 'systemctl status $SERVICE_NAME'." >&2
else
  echo "Updated to $LATEST_VERSION. Please restart crablite (old binary saved as .bak)."
  if pgrep -f "$BIN" >/dev/null 2>&1; then
    echo "Note: an old crablite process is still running; restart it to pick up the new binary."
  fi
fi
