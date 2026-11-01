---
kind: external_dependency
name: Docker Hub registry for image publishing
slug: docker-hub
category: external_dependency
category_hints:
    - vendor_identity
    - client_constraint
scope:
    - '**'
---

### Docker Hub
- Role: Container image registry; the project publishes `wangyucode/rust-sqlite-webui` with `latest` and `${VERSION}` tags.
- Integration point: `.github/workflows/docker-publish.yml` logs in via `docker/login-action@v3` using `secrets.DOCKERHUB_TOKEN` (username `wangyucode`) and pushes through `docker/build-push-action@v5`.
- Client constraint: The workflow runs on `ubuntu-latest` with Buildx enabled; images are built multi-stage (Node frontend + Rust backend) and deployed to the same registry.
- Verify exact registry credentials and tag policy against the current workflow secrets.