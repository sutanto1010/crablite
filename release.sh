#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

for command_name in cargo cargo-zigbuild gh git pnpm rustc rustup tar zip zig; do
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

if [[ ! -f "${ROOT_DIR}/update.sh" ]]; then
  echo "Error: update.sh not found in ${ROOT_DIR}." >&2
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

HOST_TARGET=$(rustc -vV | sed -n 's/^host: //p')
CROSS_TARGETS=(
  x86_64-unknown-linux-musl
  aarch64-unknown-linux-musl
  x86_64-pc-windows-gnu
  aarch64-pc-windows-gnullvm
)
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
ARCHIVES=()

build_and_package() {
  local target=$1
  local binary_name=crablite
  local binary_path
  local package="crablite-v${VERSION}-${target}"
  local package_dir="${WORK_DIR}/${package}"
  local archive="${WORK_DIR}/${package}.tar.gz"

  if [[ "$target" == "$HOST_TARGET" ]]; then
    echo "Building backend ${VERSION} for ${target} (native)..."
    cargo build --manifest-path backend/Cargo.toml --release --locked
    binary_path="backend/target/release/${binary_name}"
  else
    echo "Building backend ${VERSION} for ${target}..."
    rustup target add "$target"
    cargo zigbuild --manifest-path backend/Cargo.toml --release --locked --target "$target"
    binary_path="backend/target/${target}/release/${binary_name}"
  fi

  if [[ "$target" == *-windows-* ]]; then
    binary_name+=".exe"
    binary_path+=".exe"
    archive="${WORK_DIR}/${package}.zip"
  fi

  echo "Packaging ${package}..."
  mkdir -p "${package_dir}/dist"
  cp "$binary_path" "${package_dir}/${binary_name}"
  cp -R frontend/dist/. "${package_dir}/dist/"
  cp "${ROOT_DIR}/update.sh" "${package_dir}/update.sh"
  chmod +x "${package_dir}/update.sh"

  if [[ "$target" == *-windows-* ]]; then
    (
      cd "$WORK_DIR"
      zip -q -r "$archive" "$package"
    )
  else
    tar -C "$WORK_DIR" -czf "$archive" "$package"
  fi
  ARCHIVES+=("$archive")
}

build_and_package "$HOST_TARGET"
for target in "${CROSS_TARGETS[@]}"; do
  if [[ "$target" != "$HOST_TARGET" ]]; then
    build_and_package "$target"
  fi
done

if [[ "$REMOTE_TAG_EXISTS" == true ]]; then
  echo "Remote tag ${TAG} already exists; resuming release publishing..."
else
  echo "Creating and pushing ${TAG}..."
  if ! git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null 2>&1; then
    git tag -a "$TAG" -m "Release ${TAG}"
  fi
  git push origin "$TAG"
fi

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Uploading archives to existing GitHub release ${TAG}..."
  gh release upload "$TAG" "${ARCHIVES[@]}" "${ROOT_DIR}/update.sh" --repo "$REPO" --clobber
else
  echo "Publishing GitHub release ${TAG} to ${REPO}..."
  gh release create "$TAG" "${ARCHIVES[@]}" "${ROOT_DIR}/update.sh" \
    --repo "$REPO" \
    --title "$TAG" \
    --generate-notes
fi
