---
kind: build_system
name: Multi-stage Docker Build with GitHub Actions CI/CD
category: build_system
scope:
    - '**'
source_files:
    - Dockerfile
    - .github/workflows/docker-publish.yml
    - backend/Cargo.toml
    - frontend/package.json
    - backend/src/main.rs
---

## Build System Overview

The project is a Rust/Axum backend + SolidJS frontend monorepo. There are no Makefiles or shell build scripts; the entire build, packaging, and deployment pipeline is defined in a single multi-stage `Dockerfile` and a GitHub Actions workflow.

## Key Files

- `Dockerfile` — three-stage build: frontend builder (Node/pnpm), backend builder (Rust/alpine), runtime (alpine).
- `.github/workflows/docker-publish.yml` — CI that builds, tags, pushes to Docker Hub, and SSH-deploys to a remote server.
- `backend/Cargo.toml` — declares package version (`0.2.3`), edition `2024`, release profile with `strip = true`, `lto = true`, `codegen-units = 1`.
- `frontend/package.json` — pnpm-based Vite/SolidJS build via `pnpm build`.
- `backend/src/main.rs` — serves the built frontend static assets from `./dist` via `ServeDir::new("dist")` as the fallback route.

## Architecture & Conventions

### Multi-stage Dockerfile

1. **Stage 1 — Frontend builder** (`node:24-alpine`): installs pnpm globally, runs `pnpm install --frozen-lockfile` against `frontend/package.json` + `frontend/pnpm-lock.yaml`, then `pnpm build` to produce `frontend/dist`.
2. **Stage 2 — Backend builder** (`rust:alpine`): installs `musl-dev` for static linking, creates a dummy Cargo project to cache dependencies, copies `Cargo.toml`/`Cargo.lock`, does a dependency-only `cargo build --release`, then copies source and rebuilds with `APP_VERSION` passed as a Cargo env var (`ARG APP_VERSION` → `RUN APP_VERSION=${APP_VERSION} cargo build --release`).
3. **Stage 3 — Runtime** (`alpine:latest`): copies only the release binary `rust-sqlite-webui` and the prebuilt `dist/` directory. Sets `ENV RUST_LOG=info`, `ENV PORT=3000`, exposes port 3000, and runs `./rust-sqlite-webui`.

### Versioning Strategy

- The authoritative version lives in `backend/Cargo.toml` under `[package] version = "0.2.3"`.
- The CI workflow extracts it at runtime with `grep '^version =' backend/Cargo.toml | cut -d '"' -f2` and temporarily rewrites both `backend/Cargo.toml` and `backend/Cargo.lock` to `0.0.0` before building, so the published image tag carries the real version while the repo stays clean.
- The extracted version is also forwarded into the Docker build as `APP_VERSION` build arg, which the backend can read via `std::env::var("APP_VERSION")`.

### CI/CD Pipeline (`.github/workflows/docker-publish.yml`)

- Triggered on push to `master` branch and via `workflow_dispatch`.
- Uses `docker/setup-buildx-action@v3`, logs in to Docker Hub via `secrets.DOCKERHUB_TOKEN`.
- Builds and pushes two tags: `wangyucode/rust-sqlite-webui:latest` and `wangyucode/rust-sqlite-webui:<VERSION>`.
- Enables GHA cache (`cache-from: type=gha`, `cache-to: type=gha,mode=max`) for Docker layers.
- Deploys via `appleboy/ssh-action@v1.0.3` to host `wycode.cn` using `secrets.SERVER_USER` / `secrets.SERVER_KEY`, running:
  ```
  docker pull wangyucode/rust-sqlite-webui:latest
  SQLITE_VERSION=<VERSION> docker compose up -d --force-recreate --pull always sqlite
  docker image prune -f
  ```

### Frontend Build Integration

- The frontend uses pnpm (enforced by `packageManager` field pinning `pnpm@10.32.1+sha512...` in `frontend/package.json`).
- Build script is `vite build`; output goes to `frontend/dist`.
- The backend statically serves this directory via `tower_http::services::ServeDir::new("dist")` as the fallback route, so the compiled SPA is embedded inside the same binary.

### Backend Release Profile

`backend/Cargo.toml` defines a release profile with:
- `strip = true` — strips symbols from the binary.
- `lto = true` — enables link-time optimization.
- `codegen-units = 1` — serializes codegen for maximum optimization.

These settings make the final Alpine image smaller and more optimized.

## Conventions & Constraints

- **Single container image**: the backend binary and the frontend static assets are baked into one Alpine image; there is no separate frontend server.
- **Frontend must be built before the backend**: the Dockerfile stage order guarantees `pnpm build` runs first and its output is copied into the runtime image.
- **pnpm lockfile is frozen**: `pnpm install --frozen-lockfile` is used in the Dockerfile, so any change to `package.json` requires regenerating `pnpm-lock.yaml`.
- **Version is sourced from `backend/Cargo.toml`**: the CI parses it rather than reading git tags; changing the version requires editing `backend/Cargo.toml` directly.
- **CI mutates the checked-in version**: the workflow sed-replaces the version in `Cargo.toml` and `Cargo.lock` to `0.0.0` before building, so the committed version may differ from the published image tag.
- **Runtime configuration**: the backend reads `API_KEY` (with default fallback) and `RUST_LOG` from environment variables; `PORT` is set to `3000` via `ENV` but the hard-coded bind address in `main.rs` ignores it.
- **No local Makefile/build script**: development relies on `pnpm start` (Vite dev server) for the frontend and direct `cargo run` for the backend; there is no top-level orchestrator script.