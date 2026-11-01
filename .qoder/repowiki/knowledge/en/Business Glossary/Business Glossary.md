---
kind: business_term
name: Business Glossary
category: business_term
scope:
    - '**'
---

### sqlite-webui
- Definition：The prebuilt binary name produced by the project (`rust-sqlite-webui` in Cargo.toml, also the archive prefix `rust-sqlite-webui-v<VERSION>-<TARGET>.tar.gz`). It is the single executable that serves both the Axum API and the static WebUI assets from `dist/`.
- Aliases：rust-sqlite-webui

### API_KEY
- Definition：Environment variable holding the secret used to gate access to the WebUI. It is required both for Docker/Podman runs and for the prebuilt binary; the default placeholder is `your-super-secure-key`.

### OPENAI_API_KEY
- Definition：Optional environment variable providing the OpenAI bearer token for the AI assistant feature. Without it the app still starts but the AI handler is non-functional.

### OPENAI_BASE_URL
- Definition：Optional environment variable overriding the OpenAI chat completions endpoint base URL; defaults to `https://api.openai.com/v1`. Allows routing requests through proxies or compatible APIs.

### OPENAI_MODEL
- Definition：Optional environment variable selecting the OpenAI model used by the AI assistant; default value is `gpt-5.4-mini`.
