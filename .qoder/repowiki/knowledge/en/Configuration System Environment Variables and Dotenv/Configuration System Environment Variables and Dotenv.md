---
kind: configuration_system
name: 'Configuration System: Environment Variables and Dotenv'
category: configuration_system
scope:
    - '**'
source_files:
    - backend/src/main.rs
    - backend/Cargo.toml
    - Dockerfile
    - frontend/vite.config.ts
---

## Approach

The application uses a minimal, environment-variable-driven configuration system. There is no dedicated config file format (no YAML/JSON/TOML config files at runtime). Configuration is loaded exclusively from environment variables, with `dotenv` used to load a `.env` file during development.

## Key Files

- `backend/src/main.rs` — single source of all runtime configuration loading.
- `backend/Cargo.toml` — declares the `dotenv = "0.15"` dependency.
- `Dockerfile` — sets default `ENV RUST_LOG=info` and `ENV PORT=3000` for the container image.
- `frontend/vite.config.ts` — Vite build/dev configuration (proxy, base path).

## How It Works

### Backend (Rust / Axum)

In `main()`:

1. `dotenv::dotenv().ok();` loads a `.env` file if present (development only; ignored in production builds).
2. Logging level is read from `RUST_LOG`, falling back to `rust_sqlite_webui=debug,tower_http=debug` via `tracing_subscriber::EnvFilter::new(std::env::var("RUST_LOG").unwrap_or_else(...))`.
3. API key authentication reads `API_KEY` directly from `std::env::var("API_KEY")` inside the `auth_middleware`; if absent it falls back to the literal default `"your-super-secure-key"`.
4. The HTTP listen address is **hardcoded** as `SocketAddr::from(([0, 0, 0, 0], 3000))` — there is no `PORT` env var lookup despite the Dockerfile setting one.
5. Database connection strings are not preloaded; the `/connect` handler accepts them from client requests (see `handlers/connection.rs`).

There is no centralized config struct or typed configuration loader — each value is read inline where needed.

### Frontend (Vite / SolidJS)

Frontend configuration lives entirely in `vite.config.ts`:

- `base: './'` — serves static assets relative to root.
- `server.proxy["/api"] = "http://localhost:3000"` — dev proxy forwards `/api` calls to the backend on port 3000.
- `build.target = "esnext"` — modern JS target.
- No runtime env vars are consumed by the frontend bundle.

### Docker Image

The multi-stage `Dockerfile` exposes two environment variables:

- `ENV RUST_LOG=info`
- `ENV PORT=3000`

Only `RUST_LOG` is actually consumed by the binary; `PORT` is set but ignored because the listen port is hardcoded to 3000.

## Conventions and Constraints

- **No config files at runtime**: All runtime settings come from environment variables; there are no `.yaml`, `.json`, `.toml`, or `.ini` config files read by the application.
- **Development `.env` support**: `dotenv::dotenv()` is called unconditionally (`.ok()` swallows errors), so a `.env` file can override environment variables locally without changing code.
- **Fallback defaults are baked into code**, not declared centrally:
  - `RUST_LOG` defaults to `rust_sqlite_webui=debug,tower_http=debug`.
  - `API_KEY` defaults to `"your-super-secure-key"` when missing.
- **Hardcoded values exist alongside env vars**: The server bind address (`0.0.0.0:3000`) is not configurable via env, even though `PORT` is defined in the Dockerfile.
- **Database credentials are request-scoped, not process-scoped**: The app does not load a DB URL from env; clients connect by sending a database path to the `/connect` endpoint.
- **Secrets are expected via environment variables**: `API_KEY` is the sole secret, read from `std::env::var`.
- **Logging is controlled via `RUST_LOG`**: Uses `tracing-subscriber`'s `EnvFilter` feature, following the standard Rust ecosystem convention.