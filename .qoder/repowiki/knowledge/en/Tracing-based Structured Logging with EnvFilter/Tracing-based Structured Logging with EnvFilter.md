---
kind: logging_system
name: Tracing-based Structured Logging with EnvFilter
category: logging_system
scope:
    - '**'
source_files:
    - backend/Cargo.toml
    - backend/src/main.rs
    - backend/src/handlers/connection.rs
    - backend/src/handlers/query.rs
    - backend/src/handlers/ai.rs
---

## What system/approach is used

The backend uses **`tracing`** (v0.1) as the instrumentation framework, with **`tracing-subscriber`** (v0.3, `env-filter` feature) for configuration and output formatting. There is no frontend-side logging concern — the frontend is a SolidJS SPA served statically by Axum.

## Key files and packages

- `backend/Cargo.toml` — declares `tracing = "0.1"` and `tracing-subscriber = { version = "0.3", features = ["env-filter"] }`.
- `backend/src/main.rs` — initializes the tracing subscriber and emits the startup log line.
- `backend/src/handlers/connection.rs` — logs connection lifecycle events (`info`, `warn`, `error`).
- `backend/src/handlers/query.rs` — logs executed SQL statements at `info` level.
- `backend/src/handlers/ai.rs` — logs AI prompt/response payloads at `debug`/`info` levels.

## Architecture and conventions

### Initialization

In `main()`, the subscriber is built via `tracing_subscriber::registry()` chained with:

1. An `EnvFilter` layer whose filter string comes from the `RUST_LOG` environment variable, defaulting to `rust_sqlite_webui=debug,tower_http=debug`. This scopes verbosity to the application crate and `tower_http`.
2. A `fmt::layer()` which writes human-readable text logs to stderr.

HTTP request/response tracing is provided separately by `tower_http::trace::TraceLayer::new_for_http()`, which is layered onto the root `Router`.

### Log levels used

| Level | Where | Purpose |
|---|---|---|
| `tracing::info!` | Startup address, DB connect, query execution, AI response | Normal operational milestones |
| `tracing::debug!` | AI prompt payload | Verbose diagnostic data |
| `tracing::warn!` | WAL mode verification failure | Recoverable anomalies |
| `tracing::error!` | DB directory creation failures, connection errors, table fetch failures | Failures requiring attention |

### Structured fields

No explicit `tracing::field!` or `.with(...)` calls are present in the codebase; all log records carry only positional message strings (e.g. `tracing::info!("Executing query: {}", payload.sql)`). No custom span hierarchy is created — spans come implicitly from `TraceLayer` for HTTP requests.

### Sinks

There is a single sink: the `fmt::layer` writing to stderr. No file sinks, JSON formatters, or external log aggregation sinks are configured.

### Configuration surface

- `RUST_LOG` — controls filtering (default: `rust_sqlite_webui=debug,tower_http=debug`).
- `API_KEY` — loaded via `dotenv` / `std::env::var` and used by the auth middleware (not a log setting).

## Conventions and constraints

- All logging goes through the `tracing` crate macros (`tracing::info!`, `tracing::debug!`, `tracing::warn!`, `tracing::error!`) rather than `println!`/`eprintln!`; this is enforced by the absence of any other logger initialization in the codebase.
- Log verbosity is controlled exclusively through the `RUST_LOG` environment variable via `EnvFilter`; there is no runtime toggle or config file for log levels.
- The default filter scope targets the `rust_sqlite_webui` crate name plus `tower_http`, so third-party crates not explicitly listed remain at their default level.
- Log messages use simple positional interpolation (`{}`); no structured key-value fields are attached to log records.
- HTTP-level request/response tracing is delegated entirely to `tower_http::trace::TraceLayer`; application handlers do not create spans manually.