---
kind: external_dependency
name: OpenAI API for the AI assistant feature
slug: openai
category: external_dependency
category_hints:
    - auth_protocol
    - sdk_real_api
scope:
    - '**'
---

### OpenAI
- Role: Optional LLM provider powering the SQL correction / natural-language-to-SQL assistant.
- Auth protocol: Bearer token injected via the `OPENAI_API_KEY` environment variable; base URL and model are configurable through `OPENAI_BASE_URL` and `OPENAI_MODEL`.
- SDK shape: Backend calls OpenAI over HTTP via `reqwest` (declared in `backend/Cargo.toml`); the default base URL is `https://api.openai.com/v1` and the default model is `gpt-5.4-mini`.
- Client constraint: Feature is opt-in — the application runs without an OpenAI key; only the AI handler requires it.
- Verify exact request/response shapes against the official OpenAI Chat Completions docs.