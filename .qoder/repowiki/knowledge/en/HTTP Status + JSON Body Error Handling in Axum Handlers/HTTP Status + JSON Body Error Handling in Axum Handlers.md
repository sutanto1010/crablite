---
kind: error_handling
name: HTTP Status + JSON Body Error Handling in Axum Handlers
category: error_handling
scope:
    - '**'
source_files:
    - backend/src/main.rs
    - backend/src/handlers/query.rs
    - backend/src/handlers/connection.rs
    - backend/src/handlers/ai.rs
    - backend/src/handlers/mod.rs
---

## Approach

The backend is a Rust/Axum application with no dedicated error type hierarchy, no custom `Error` enum, and no centralized error middleware. Errors are handled inline inside each handler by:

1. Returning `(StatusCode, String)` tuples via `impl IntoResponse` for HTTP-level failures.
2. Wrapping operational errors (SQL execution, I/O) into a typed JSON response body that carries an `error: Option<String>` field alongside the normal payload.
3. Using `tracing` macros (`info!`, `warn!`, `error!`, `debug!`) to log errors at the point of occurrence.
4. Propagating configuration/IO panics through `unwrap()` at process bootstrap only.

There is no `panic!` usage in business logic; `panic!`-adjacent calls are limited to startup code (`main.rs`).

## Key Files

- `backend/src/main.rs` — auth middleware, tracing setup, server bootstrap, `unwrap()` on bind/serve.
- `backend/src/handlers/query.rs` — `QueryResponse { columns, column_types, rows, affected_rows, execution_time, error }` pattern.
- `backend/src/handlers/connection.rs` — `(StatusCode, String)` responses for filesystem/DB errors; `verify_wal_mode` returns `Result<(), String>`.
- `backend/src/handlers/ai.rs` — `CorrectResponse { sql, error }` pattern; external API errors surfaced as strings.
- `backend/src/handlers/mod.rs` — re-exports handlers; no shared error module.

## Architecture & Conventions

### Two parallel error channels

**HTTP-level errors** use Axum's `IntoResponse` tuple form:

```rust
(StatusCode::BAD_REQUEST, "No database connected").into_response()
(StatusCode::NOT_FOUND, "Database file not found").into_response()
(StatusCode::INTERNAL_SERVER_ERROR, "Failed to connect: ..." ).into_response()
```

These are used for validation failures, missing state, and IO errors where no structured JSON payload is needed.

**Operational errors** are embedded in typed JSON responses via an `error: Option<String>` field:

- `QueryResponse.error` — SQL execution errors from `sqlx::query(...).fetch_all().await` or `.execute().await` are caught by `match result { Ok(..) | Err(e) => Json(QueryResponse { ..., error: Some(e.to_string()) }) }`.
- `CorrectResponse.error` — missing `OPENAI_API_KEY`, non-2xx HTTP status from the AI provider, or network errors are serialized as strings.

This means callers (the SolidJS frontend) must inspect both the HTTP status code and the `error` field of the JSON body.

### Middleware error handling

The auth middleware (`auth_middleware` in `main.rs`) returns `Result<Response, StatusCode>` and maps missing/mismatched `x-api-key` headers to `StatusCode::UNAUTHORIZED`. It does not return a JSON body — clients receive a plain 401.

### Logging convention

Errors are logged with `tracing` before being returned:

- `tracing::error!("Failed to create db directory: {}", e);`
- `tracing::error!("Failed to connect: {}", e);`
- `tracing::error!("Failed to fetch tables: {}", e);`
- `tracing::warn!("WAL mode verification failed: {}", e);`
- `tracing::debug!("AI API prompt: {}", prompt);`

There is no structured error envelope (no error codes, no request IDs, no stack traces).

### Startup vs runtime boundary

`unwrap()` is used only at process initialization:

- `std::env::var("API_KEY").unwrap_or_else(...)` — defaults to a placeholder string when env var is absent.
- `tokio::net::TcpListener::bind(addr).await.unwrap();`
- `axum::serve(listener, app).await.unwrap();`

Business logic avoids `unwrap()` and instead uses `match`, `if let`, and `unwrap_or_default()` / `unwrap_or_else` patterns (e.g., `ai.rs` schema fetching uses `unwrap_or_default()` for optional PRAGMA queries).

### No centralized error types

There is no `errors.rs`, no `anyhow::Context`, no custom `AppError` struct, and no `From<sqlx::Error>` implementation. Each handler converts its own errors directly to either a `StatusCode` tuple or a JSON body string.

## Conventions Observed

- Validation and precondition failures → `(StatusCode, &str)` tuple response.
- Operational failures (SQL, network, filesystem) → typed JSON response with `error: Option<String>` populated; successful paths set `error: None`.
- All errors are logged via `tracing` before returning.
- External dependencies (OpenAI client, sqlx, std::fs) are wrapped in `match`/`if let`; `unwrap()` is reserved for startup-only code.
- The auth middleware is the only place that short-circuits with a raw `StatusCode` without a JSON body.
- There is no global error handler layer (no `tower_http::ErrorLayer` or custom `ErrorHandler`), so unhandled panics would propagate as Axum's default 500.

## Constraints Enforced by the Code

- Every handler returns `impl IntoResponse`, which constrains error shapes to either `(StatusCode, String)` or a serializable struct — there is no path that returns a bare `Result<T, E>` that Axum would convert automatically.
- The `QueryResponse` and `CorrectResponse` structs enforce that every JSON response includes an `error` field (nullable), making it impossible to omit the error channel from these endpoints.