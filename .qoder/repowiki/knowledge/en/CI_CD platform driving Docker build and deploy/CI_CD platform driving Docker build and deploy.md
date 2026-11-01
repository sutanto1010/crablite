---
kind: external_dependency
name: CI/CD platform driving Docker build and deploy
slug: github-actions
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
---

### GitHub Actions
- Role: Triggers on push to `master` or `workflow_dispatch`; builds the Docker image and deploys it to a remote server.
- Secrets consumed: `DOCKERHUB_TOKEN`, `SERVER_USER`, `SERVER_KEY`.