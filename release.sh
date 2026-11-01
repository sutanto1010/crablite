#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

for command_name in cargo gh git pnpm rustc tar; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: required command not found: $command_name" >&2
    exit 1
  fi
done

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: commit or stash all changes before creating a release." >&2
  exit 1
fi

VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' backend/Cargo.toml)
if [[ -z "$VERSION" ]]; then
  echo "Error: could not read the version from backend/Cargo.toml." >&2
  exit 1
fi

REMOTE_URL=$(git remote get-url origin)
REPO=$(printf '%s\n' "$REMOTE_URL" | sed -E -n 's#.*github\.com[:/]([^/]+/[^/]+)#\1#p')
REPO=${REPO%.git}
if [[ -z "$REPO" ]]; then
  echo "Error: could not determine the GitHub repository from origin: ${REMOTE_URL}" >&2
  exit 1
fi

TAG="v${VERSION}"
REMOTE_TAG_EXISTS=false
if git ls-remote --exit-code --tags origin "refs/tags/${TAG}" >/dev/null 2>&1; then
  REMOTE_TAG_EXISTS=true
fi

gh auth status

echo "Building frontend..."
(
  cd frontend
  pnpm install --frozen-lockfile
  pnpm build
)

echo "Building backend ${VERSION}..."
cargo build --manifest-path backend/Cargo.toml --release --locked

TARGET=$(rustc -vV | sed -n 's/^host: //p')
PACKAGE="rust-sqlite-webui-v${VERSION}-${TARGET}"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
PACKAGE_DIR="${WORK_DIR}/${PACKAGE}"
ARCHIVE="${WORK_DIR}/${PACKAGE}.tar.gz"

echo "Packaging ${PACKAGE}.tar.gz..."
mkdir -p "${PACKAGE_DIR}/dist"
cp backend/target/release/rust-sqlite-webui "${PACKAGE_DIR}/"
cp -R frontend/dist/. "${PACKAGE_DIR}/dist/"
tar -C "$WORK_DIR" -czf "$ARCHIVE" "$PACKAGE"

if [[ "$REMOTE_TAG_EXISTS" == true ]]; then
  echo "Remote tag ${TAG} already exists; resuming release publishing..."
else
  echo "Creating and pushing ${TAG}..."
  if ! git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null 2>&1; then
    git tag -a "$TAG" -m "Release ${TAG}"
  fi
  git push origin "$TAG"
fi

echo "Publishing GitHub release ${TAG} to ${REPO}..."
gh release create "$TAG" "$ARCHIVE" \
  --repo "$REPO" \
  --title "$TAG" \
  --generate-notes
