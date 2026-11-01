# Backend Development

<cite>
**Referenced Files in This Document**
- [main.rs](file://backend/src/main.rs)
- [state.rs](file://backend/src/state.rs)
- [handlers/mod.rs](file://backend/src/handlers/mod.rs)
- [connection.rs](file://backend/src/handlers/connection.rs)
- [query.rs](file://backend/src/handlers/query.rs)
- [ai.rs](file://backend/src/handlers/ai.rs)
- [health.rs](file://backend/src/handlers/health.rs)
- [Cargo.toml](file://backend/Cargo.toml)
</cite>

## Update Summary
**Changes Made**
- Updated backend package name to 'crablite' and Rust edition to 2024
- Enhanced logging configuration with project-specific tracing filters
- Updated version to 26.11.3 with improved database directory handling
- Added comprehensive error handling for directory creation operations
- Implemented configurable database directory path via DB_DIR environment variable

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)

## Introduction
This document provides comprehensive backend development documentation for the crablite Rust-based server application. It explains the entry point, state management using a shared database pool protected by async read-write locks, handler organization, and the database layer including connection lifecycle, WAL mode configuration, and recursive file discovery with security validation. It also documents API endpoints for connection management, query execution, and AI integration, along with authentication middleware, error handling strategies, logging configuration, and performance considerations such as connection pooling and async I/O patterns.

## Project Structure
The backend is an Axum-based HTTP service that:
- Initializes tracing and environment variables with project-specific logging configuration
- Shares a database pool across handlers via application state
- Exposes REST endpoints under /api
- Serves static frontend assets from dist
- Applies authentication middleware to API routes
- Supports configurable database directory paths with automatic nested directory creation

```mermaid
graph TB
A["main.rs<br/>Entry point"] --> B["handlers/mod.rs<br/>Handler registry"]
A --> C["state.rs<br/>AppState"]
B --> D["handlers/connection.rs<br/>Connection & DB listing"]
B --> E["handlers/query.rs<br/>Query execution"]
B --> F["handlers/ai.rs<br/>AI correction"]
B --> G["handlers/health.rs<br/>Health check"]
A --> H["Axum Router<br/>Routes + Middleware"]
H --> I["tower_http::TraceLayer<br/>HTTP tracing"]
H --> J["ServeDir::new('dist')<br/>Static files"]
```

**Diagram sources**
- [main.rs:36-83](file://backend/src/main.rs#L36-L83)
- [handlers/mod.rs:1-10](file://backend/src/handlers/mod.rs#L1-L10)
- [state.rs:6-10](file://backend/src/state.rs#L6-L10)

**Section sources**
- [main.rs:1-84](file://backend/src/main.rs#L1-L84)
- [handlers/mod.rs:1-10](file://backend/src/handlers/mod.rs#L1-L10)

## Core Components
- Application state: Holds a shared, asynchronously locked optional SQLite pool and configurable database directory path.
- Handlers: Organized by feature (connection, query, ai, health).
- Database layer: Uses sqlx with Tokio runtime, WAL journal mode, busy timeout, and pool-based connections.
- Authentication: Header-based API key middleware protecting API routes.
- Logging: Tracing subscriber configured via environment variable RUST_LOG with project-specific filtering.

Key responsibilities:
- main.rs: Bootstraps tracing with crablite-specific logging, constructs AppState with configurable db_dir, registers routes, applies middleware, binds TCP listener.
- state.rs: Defines AppState with Arc<RwLock<Option<SqlitePool>>> and PathBuf for database directory.
- handlers/connection.rs: Lists .db files recursively, connects to a SQLite database, verifies WAL mode, lists tables.
- handlers/query.rs: Executes SQL, serializes rows into JSON, measures execution time.
- handlers/ai.rs: Calls OpenAI-compatible API to correct or generate SQL based on table schema and sample row.
- handlers/health.rs: Returns status and version info.

**Updated** Enhanced database directory handling with automatic nested directory creation using `create_dir_all` and improved error handling.

**Section sources**
- [main.rs:36-83](file://backend/src/main.rs#L36-L83)
- [state.rs:6-10](file://backend/src/state.rs#L6-L10)
- [handlers/connection.rs:20-145](file://backend/src/handlers/connection.rs#L20-L145)
- [handlers/query.rs:101-200](file://backend/src/handlers/query.rs#L101-L200)
- [handlers/ai.rs:24-148](file://backend/src/handlers/ai.rs#L24-L148)
- [handlers/health.rs:1-6](file://backend/src/handlers/health.rs#L1-L6)

## Architecture Overview
The system follows a layered architecture:
- HTTP Layer: Axum router with middleware (auth, tracing) and static file serving.
- Handler Layer: Feature-specific handlers for connection, queries, AI, and health.
- State Layer: Shared AppState containing the database pool and configurable database directory.
- Data Layer: SQLite via sqlx with connection pooling and WAL mode.

```mermaid
sequenceDiagram
participant Client as "Client"
participant Axum as "Axum Router"
participant Auth as "Auth Middleware"
participant ConnH as "connect_db handler"
participant Pool as "SqlitePool"
participant FS as "Filesystem"
Client->>Axum : POST /api/connect {path, create}
Axum->>Auth : validate x-api-key
Auth-->>Axum : allow or reject
Axum->>ConnH : connect_db(payload)
ConnH->>FS : validate path, ensure db dir with create_dir_all
ConnH->>Pool : SqlitePool : : connect_with(options)
Pool-->>ConnH : Ok(pool)
ConnH->>Pool : verify_wal_mode()
Pool-->>ConnH : ok/warn
ConnH-->>Axum : 200 OK
Axum-->>Client : 200 OK
```

**Diagram sources**
- [main.rs:23-34](file://backend/src/main.rs#L23-L34)
- [main.rs:57-71](file://backend/src/main.rs#L57-L71)
- [connection.rs:62-109](file://backend/src/handlers/connection.rs#L62-L109)
- [connection.rs:131-144](file://backend/src/handlers/connection.rs#L131-L144)

## Detailed Component Analysis

### Entry Point and Routing (main.rs)
Responsibilities:
- Initialize dotenv and tracing subscriber with EnvFilter and fmt layer using crablite-specific logging configuration.
- Create AppState with Arc<RwLock<Option<SqlitePool>>> initialized to None and configurable db_dir.
- Register API routes under /api with auth middleware.
- Serve static frontend assets from dist.
- Bind to port 3000 and start the server.

Authentication middleware:
- Reads API_KEY from environment; compares against x-api-key header.
- Returns 401 Unauthorized if mismatch.

Logging:
- Configured via RUST_LOG env var with default filter "crablite=debug,tower_http=debug".
- Uses tracing-subscriber with project-specific module filtering.

Database Directory Configuration:
- Uses DB_DIR environment variable to configure database storage location.
- Defaults to "db" directory if not specified.
- Logs the configured database directory path during startup.

```mermaid
flowchart TD
Start(["Process start"]) --> Dotenv["Load .env"]
Dotenv --> InitTracing["Init tracing subscriber with crablite filter"]
InitTracing --> GetDBDir["Get DB_DIR env var or default 'db'"]
GetDBDir --> BuildState["Create AppState(db=None, db_dir)"]
BuildState --> BuildRouter["Build Router with /api routes"]
BuildRouter --> ApplyMiddleware["Apply auth_middleware"]
ApplyMiddleware --> ServeStatic["Serve static 'dist'"]
ServeStatic --> BindPort["Bind TCP :3000"]
BindPort --> RunServer["Start axum::serve"]
```

**Diagram sources**
- [main.rs:36-83](file://backend/src/main.rs#L36-L83)

**Updated** Added DB_DIR environment variable support for configurable database directory paths and enhanced logging configuration with project-specific filters.

**Section sources**
- [main.rs:1-84](file://backend/src/main.rs#L1-L84)

### State Management (state.rs)
- AppState holds a shared database pool wrapped in Arc<RwLock<Option<SqlitePool>>> and a PathBuf for the database directory.
- Cloneable for sharing across handlers.

Design notes:
- Using RwLock allows concurrent reads and exclusive writes when connecting/disconnecting.
- Option<SqlitePool> indicates no active connection until connect_db is called.
- PathBuf db_dir enables flexible database storage locations.

**Updated** Added db_dir field to support configurable database directory paths.

**Section sources**
- [state.rs:1-11](file://backend/src/state.rs#L1-L11)

### Connection Management and File Discovery (handlers/connection.rs)
Endpoints:
- GET /api/db-files: Recursively list .db files under db/, excluding WAL/SHM files.
- POST /api/connect: Connect to a SQLite database at a given path, optionally creating it.
- GET /api/tables: List tables from the connected database.

Security and validation:
- Rejects paths containing ".." to prevent directory traversal.
- Ensures db directory exists using `create_dir_all` for nested structures; creates it if missing.
- Validates existence unless create flag is set.

Database options:
- Enables WAL journal mode.
- Sets busy_timeout to avoid multi-process contention.
- Verifies WAL mode after connection.

Recursive file discovery:
- Scans db directory recursively.
- Filters only .db files and excludes -wal/-shm suffixes.
- Records relative paths from db root.

**Updated** Enhanced directory handling with `create_dir_all` to support nested directory structures and improved error handling for directory creation failures.

```mermaid
flowchart TD
Start(["list_dbs"]) --> CheckDBDir["Check 'db' dir exists"]
CheckDBDir --> |No| CreateDir["Use create_dir_all to create nested 'db' dir"]
CreateDir --> ReturnEmpty["Return []"]
CheckDBDir --> |Yes| Scan["Recursively scan entries"]
Scan --> Filter[".db only, exclude -wal/-shm"]
Filter --> Collect["Collect relative paths"]
Collect --> End(["Return JSON array"])
```

**Diagram sources**
- [connection.rs:20-60](file://backend/src/handlers/connection.rs#L20-L60)

```mermaid
flowchart TD
Start(["connect_db"]) --> ValidatePath["Reject '..' in path"]
ValidatePath --> EnsureDir["Use create_dir_all to ensure 'db' dir exists"]
EnsureDir --> Exists{"File exists or create?"}
Exists --> |No and not create| NotFound["404 Not Found"]
Exists --> |Yes or create| BuildOpts["Build SqliteConnectOptions<br/>WAL + busy_timeout"]
BuildOpts --> Connect["SqlitePool::connect_with"]
Connect --> VerifyWAL["verify_wal_mode()"]
VerifyWAL --> UpdateState["Update AppState.db"]
UpdateState --> Ok["200 OK"]
```

**Diagram sources**
- [connection.rs:62-109](file://backend/src/handlers/connection.rs#L62-L109)
- [connection.rs:131-144](file://backend/src/handlers/connection.rs#L131-L144)

**Section sources**
- [connection.rs:1-145](file://backend/src/handlers/connection.rs#L1-L145)

### Query Execution (handlers/query.rs)
Endpoint:
- POST /api/query: Execute arbitrary SQL against the connected SQLite database.

Behavior:
- Determines whether to fetch rows or execute non-select statements based on SQL prefix heuristics (SELECT, PRAGMA, EXPLAIN, WITH, RETURNING).
- Serializes rows into JSON with typed handling for NULL, integers, floats, booleans, blobs, and strings.
- Measures execution time and returns columns, column types, rows, affected_rows, and error messages.

Error handling:
- If no database is connected, returns a structured response indicating the issue.
- Errors are captured and returned in the response payload rather than failing the request.

```mermaid
flowchart TD
Start(["execute_query"]) --> ReadState["Read AppState.db"]
ReadState --> HasPool{"Pool available?"}
HasPool --> |No| NoPoolResp["Return error response"]
HasPool --> |Yes| Classify["Classify SQL type"]
Classify --> SelectLike{"Returns rows?"}
SelectLike --> |Yes| FetchAll["fetch_all()"]
FetchAll --> Serialize["serialize_row() per row"]
Serialize --> RespRows["Return columns/types/rows/time"]
SelectLike --> |No| Exec["execute()"]
Exec --> RespExec["Return affected_rows/time"]
```

**Diagram sources**
- [query.rs:101-200](file://backend/src/handlers/query.rs#L101-L200)

**Section sources**
- [query.rs:1-201](file://backend/src/handlers/query.rs#L1-L201)

### AI Integration (handlers/ai.rs)
Endpoint:
- POST /api/correct: Correct or generate SQL using an OpenAI-compatible API.

Flow:
- Reads OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL from environment.
- Retrieves table schema via pragma_table_info and foreign keys via pragma_foreign_key_list.
- Optionally samples one row to enrich the prompt.
- Constructs a prompt describing the table schema and user input.
- Sends a chat completion request to the configured base URL.
- Parses the response and returns generated SQL or error details.

Configuration:
- Requires OPENAI_API_KEY; otherwise returns an error response.
- Defaults base URL and model if not provided.

```mermaid
sequenceDiagram
participant Client as "Client"
participant AIH as "correct_sql handler"
participant DB as "SqlitePool"
participant HTTP as "reqwest Client"
participant LLM as "OpenAI-compatible API"
Client->>AIH : POST /api/correct {sql, table}
AIH->>DB : pragma_table_info(table)
DB-->>AIH : columns
AIH->>DB : pragma_foreign_key_list(table)
DB-->>AIH : foreign_keys
AIH->>DB : SELECT * FROM table LIMIT 1
DB-->>AIH : sample row
AIH->>HTTP : POST /chat/completions
HTTP->>LLM : bearer_auth(api_key), json payload
LLM-->>HTTP : 200 OK with choices
HTTP-->>AIH : parsed body
AIH-->>Client : {sql, error?}
```

**Diagram sources**
- [ai.rs:24-148](file://backend/src/handlers/ai.rs#L24-L148)

**Section sources**
- [ai.rs:1-149](file://backend/src/handlers/ai.rs#L1-L149)

### Health Check (handlers/health.rs)
Endpoint:
- GET /api/health: Returns status and version information.

Version resolution:
- Uses APP_VERSION environment variable if present; falls back to Cargo package version.

**Section sources**
- [health.rs:1-6](file://backend/src/handlers/health.rs#L1-L6)

## Dependency Analysis
External dependencies and their roles:
- axum: Web framework for routing and middleware.
- tokio: Async runtime.
- sqlx: Database toolkit with SQLite support and Tokio runtime features.
- serde/serde_json: Serialization/deserialization for requests/responses.
- tower_http: Static file serving and HTTP tracing.
- tracing/tracing-subscriber: Structured logging and filtering with project-specific configuration.
- reqwest: HTTP client for AI provider calls.
- dotenv: Environment variable loading.

**Updated** Backend package renamed to 'crablite', Rust edition updated to 2024, and version bumped to 26.11.3.

```mermaid
graph LR
Axum["axum"] --> Main["main.rs"]
Tokio["tokio"] --> Main
Sqlx["sqlx"] --> Conn["connection.rs"]
Sqlx --> Query["query.rs"]
Serde["serde/serde_json"] --> All["handlers/*"]
TowerHttp["tower_http"] --> Main
Tracing["tracing*"] --> Main
Reqwest["reqwest"] --> AI["ai.rs"]
Dotenv["dotenv"] --> Main
```

**Diagram sources**
- [Cargo.toml:6-18](file://backend/Cargo.toml#L6-L18)
- [main.rs:1-18](file://backend/src/main.rs#L1-L18)
- [connection.rs:1-10](file://backend/src/handlers/connection.rs#L1-L10)
- [query.rs:1-10](file://backend/src/handlers/query.rs#L1-L10)
- [ai.rs:1-10](file://backend/src/handlers/ai.rs#L1-L10)

**Section sources**
- [Cargo.toml:1-24](file://backend/Cargo.toml#L1-L24)

## Performance Considerations
- Connection pooling: SqlitePool manages multiple connections, reducing overhead and enabling concurrent access.
- WAL mode: Improves concurrency and reduces locking issues compared to default journaling.
- Busy timeout: Prevents immediate failures under contention by waiting for lock availability.
- Async I/O: Tokio runtime handles asynchronous operations for HTTP and database interactions.
- Tracing: Use TraceLayer and structured logs to monitor request latency and errors with project-specific filtering.
- Release optimizations: Binary stripping, LTO, and single codegen unit improve release performance.
- File system operations: `create_dir_all` efficiently handles nested directory creation with proper error handling.

Recommendations:
- Tune pool size based on expected concurrency and workload characteristics.
- Monitor WAL mode verification and adjust busy_timeout if needed.
- Profile slow queries and consider indexes or query restructuring.
- Use structured logging levels appropriately to balance verbosity and performance.
- Configure appropriate DB_DIR paths for optimal file system performance.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- Unauthorized access: Ensure x-api-key header matches API_KEY environment variable.
- Database not connected: Call /api/connect before executing queries or listing tables.
- WAL mode mismatch: Verify WAL mode after connection; check SQLite permissions and file system behavior.
- Directory traversal blocked: Avoid ".." in requested paths; use allowed subdirectories under db/.
- Missing AI credentials: Set OPENAI_API_KEY; configure OPENAI_BASE_URL and OPENAI_MODEL as needed.
- Static files not served: Ensure dist directory exists and contains built frontend assets.
- Database directory creation failed: Check filesystem permissions and disk space; verify DB_DIR environment variable configuration.
- Logging issues: Check RUST_LOG configuration uses "crablite=debug" format for project-specific logs.

Operational tips:
- Inspect logs via RUST_LOG to identify errors and request flows with crablite-specific filtering.
- Validate environment variables using a .env file loaded by dotenv.
- Test endpoints with curl or Postman, verifying headers and payloads.
- Configure DB_DIR environment variable to customize database storage location.
- Monitor directory creation operations in logs for permission issues.

**Updated** Added troubleshooting guidance for database directory creation, DB_DIR configuration, and crablite-specific logging setup.

**Section sources**
- [main.rs:23-34](file://backend/src/main.rs#L23-L34)
- [connection.rs:62-109](file://backend/src/handlers/connection.rs#L62-L109)
- [ai.rs:24-37](file://backend/src/handlers/ai.rs#L24-L37)

## Conclusion
The backend implements a secure, modular, and performant SQLite web UI server using Axum and sqlx. It leverages connection pooling, WAL mode, and async I/O to handle concurrent workloads efficiently. The handler organization separates concerns clearly, while authentication middleware protects API endpoints. Logging and tracing provide observability with project-specific filtering. Extensibility points include adding new endpoints, integrating additional AI providers, and expanding database operations through the existing state and handler patterns.

**Updated** Enhanced with improved database directory handling supporting nested structures and configurable storage locations via DB_DIR environment variable. The project has been updated to Rust edition 2024, package name 'crablite', and version 26.11.3 for improved compatibility and performance. The logging system now uses project-specific filtering for better observability.

[No sources needed since this section summarizes without analyzing specific files]