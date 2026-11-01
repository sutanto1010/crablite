# State Management & Database Connection Pooling

<cite>
**Referenced Files in This Document**
- [state.rs](file://backend/src/state.rs)
- [main.rs](file://backend/src/main.rs)
- [connection.rs](file://backend/src/handlers/connection.rs)
- [query.rs](file://backend/src/handlers/query.rs)
- [Cargo.toml](file://backend/Cargo.toml)
</cite>

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
10. [Appendices](#appendices)

## Introduction
This document explains the application state management system and database connection pooling strategy used by the backend service. It focuses on the AppState struct design, which uses Arc<RwLock<Option<SqlitePool>>> to provide thread-safe global access to a SQLite connection pool. You will learn how the pool is initialized, how concurrent read/write access is synchronized, and how handlers safely interact with shared state. The guide also covers memory management, connection pooling best practices, performance implications, and strategies for extending the state structure with additional shared resources.

## Project Structure
The backend is an Axum-based HTTP service that:
- Initializes tracing/logging
- Builds routes under /api
- Shares a single AppState instance across all handlers
- Uses a SqlitePool from sqlx for efficient database connections

```mermaid
graph TB
subgraph "Backend Service"
A["main.rs<br/>App bootstrap"] --> B["Router<br/>/api/* routes"]
B --> C["handlers/connection.rs<br/>connect_db, list_dbs, list_tables"]
B --> D["handlers/query.rs<br/>execute_query"]
C --> E["state.rs<br/>AppState(db: Arc<RwLock<Option<SqlitePool>>>)"]
D --> E
end
```

**Diagram sources**
- [main.rs:35-73](file://backend/src/main.rs#L35-L73)
- [connection.rs:62-129](file://backend/src/handlers/connection.rs#L62-L129)
- [query.rs:101-200](file://backend/src/handlers/query.rs#L101-L200)
- [state.rs:5-8](file://backend/src/state.rs#L5-L8)

**Section sources**
- [main.rs:35-73](file://backend/src/main.rs#L35-L73)

## Core Components
- AppState: Holds the globally shared database pool behind a read-write lock.
- Connection handler: Creates or connects to a SQLite file, configures WAL mode and busy timeout, and stores the pool into AppState.
- Query handler: Reads the pool from AppState and executes SQL queries concurrently using the pooled connections.

Key responsibilities:
- Thread-safe initialization and replacement of the active database pool
- Safe concurrent reads of the pool for query execution
- Clear error handling when no database is connected

**Section sources**
- [state.rs:5-8](file://backend/src/state.rs#L5-L8)
- [connection.rs:62-129](file://backend/src/handlers/connection.rs#L62-L129)
- [query.rs:101-200](file://backend/src/handlers/query.rs#L101-L200)

## Architecture Overview
The application follows a layered architecture:
- Entry point initializes AppState and Axum Router
- Handlers extract AppState via Axum’s State extractor
- Handlers use tokio::sync::RwLock to synchronize access to the optional SqlitePool
- sqlx::SqlitePool manages multiple lightweight connections to the same SQLite file

```mermaid
sequenceDiagram
participant Client as "HTTP Client"
participant Router as "Axum Router"
participant ConnH as "Connection Handler"
participant QueryH as "Query Handler"
participant State as "AppState (Arc<RwLock<Option<SqlitePool>>)"
participant Pool as "SqlitePool"
Client->>Router : POST /api/connect {path, create}
Router->>ConnH : connect_db()
ConnH->>State : write().await -> set Some(pool)
ConnH-->>Client : 200 OK
Client->>Router : POST /api/query {sql}
Router->>QueryH : execute_query()
QueryH->>State : read().await -> get Option<pool>
alt Connected
QueryH->>Pool : execute/fetch_all(sql)
Pool-->>QueryH : rows/affected_rows
QueryH-->>Client : JSON result
else Not connected
QueryH-->>Client : Error response
end
```

**Diagram sources**
- [main.rs:47-65](file://backend/src/main.rs#L47-L65)
- [connection.rs:62-108](file://backend/src/handlers/connection.rs#L62-L108)
- [query.rs:101-200](file://backend/src/handlers/query.rs#L101-L200)

## Detailed Component Analysis

### AppState Design and Concurrency Model
- AppState contains db: Arc<RwLock<Option<SqlitePool>>>
  - Arc enables cheap cloning and sharing across tasks and handlers
  - RwLock allows multiple concurrent readers and exclusive writers
  - Option<SqlitePool> represents “no connection yet” vs “connected”
- Clone derives allow passing AppState into handlers without extra indirection

Concurrency guarantees:
- Writers (e.g., connecting/replacing the pool) acquire a write lock
- Readers (e.g., executing queries) acquire a read lock
- Only one writer at a time; many readers can proceed concurrently

Memory model:
- Arc ensures the pool lives until all references are dropped
- Replacing the pool drops the old pool when no longer referenced

Best practices:
- Keep write sections minimal to reduce contention
- Prefer read locks for query paths
- Avoid holding locks across long-running operations outside the pool

```mermaid
classDiagram
class AppState {
+db : Arc<RwLock<Option<SqlitePool>>>
}
class SqlitePool
class RwLock
class Arc
AppState --> Arc
Arc --> RwLock
RwLock --> SqlitePool
```

**Diagram sources**
- [state.rs:5-8](file://backend/src/state.rs#L5-L8)

**Section sources**
- [state.rs:5-8](file://backend/src/state.rs#L5-L8)

### Database Connection Lifecycle
Initialization and connection flow:
- On startup, AppState.db is initialized to None inside a RwLock
- When a client calls /api/connect:
  - Validate path and ensure db directory exists
  - Build SqliteConnectOptions with WAL mode and busy_timeout
  - Create SqlitePool::connect_with(options)
  - Optionally verify WAL mode
  - Acquire write lock and store Some(pool) into AppState.db

```mermaid
flowchart TD
Start(["POST /api/connect"]) --> Validate["Validate path and create db dir if needed"]
Validate --> Options["Build SqliteConnectOptions<br/>WAL + busy_timeout"]
Options --> Connect["Create SqlitePool::connect_with(options)"]
Connect --> Verify{"Verify WAL mode?"}
Verify --> |Yes| CheckWAL["Check PRAGMA journal_mode == 'wal'"]
Verify --> |No| StorePool["Acquire write lock and set Some(pool)"]
CheckWAL --> StorePool
StorePool --> Done(["200 OK"])
```

**Diagram sources**
- [connection.rs:62-108](file://backend/src/handlers/connection.rs#L62-L108)
- [connection.rs:131-144](file://backend/src/handlers/connection.rs#L131-L144)

**Section sources**
- [connection.rs:62-108](file://backend/src/handlers/connection.rs#L62-L108)
- [connection.rs:131-144](file://backend/src/handlers/connection.rs#L131-L144)

### Concurrent Access Safety Mechanisms
Readers (query execution):
- Acquire read lock to obtain Option<&SqlitePool>
- If None, return an error indicating no database is connected
- If Some, execute queries against the pool

Writers (connecting/replacing):
- Acquire write lock to replace the pool
- Ensures only one connection operation happens at a time

```mermaid
flowchart TD
Enter(["Handler entry"]) --> LockType{"Operation type?"}
LockType --> |Read| ReadLock["read().await"]
LockType --> |Write| WriteLock["write().await"]
ReadLock --> HasPool{"Option<SqlitePool> present?"}
HasPool --> |No| ErrResp["Return 'not connected' error"]
HasPool --> |Yes| Exec["Execute query via pool"]
WriteLock --> Replace["Replace pool with new one"]
Exec --> Exit(["Exit"])
Replace --> Exit
```

**Diagram sources**
- [query.rs:101-200](file://backend/src/handlers/query.rs#L101-L200)
- [connection.rs:92-108](file://backend/src/handlers/connection.rs#L92-L108)

**Section sources**
- [query.rs:101-200](file://backend/src/handlers/query.rs#L101-L200)
- [connection.rs:92-108](file://backend/src/handlers/connection.rs#L92-L108)

### Example Patterns for Safe Shared-State Access
- Reading the pool in a handler:
  - Use State<AppState> extractor
  - Acquire read lock
  - Match on Option<SqlitePool>
  - Execute queries and map results to JSON
- Writing the pool in a handler:
  - Use State<AppState> extractor
  - Acquire write lock
  - Set the pool to Some(new_pool) after successful connection

These patterns appear in:
- Connection handler: creating and storing the pool
- Query handler: reading the pool to execute queries

**Section sources**
- [connection.rs:62-108](file://backend/src/handlers/connection.rs#L62-L108)
- [query.rs:101-200](file://backend/src/handlers/query.rs#L101-L200)

### Memory Management Considerations
- Arc reference counting:
  - Cloning AppState increments the reference count
  - Dropping all clones decrements the count and frees the pool when zero
- RwLock overhead:
  - Minimal for short critical sections
  - Avoid long-held locks to prevent contention
- Pool lifecycle:
  - When replacing the pool, the old pool is dropped automatically when no longer referenced
  - Ensure no lingering references exist before replacing

Recommendations:
- Keep write sections short
- Avoid blocking I/O while holding locks
- Use drop explicitly if you need to release early within a scope

**Section sources**
- [state.rs:5-8](file://backend/src/state.rs#L5-L8)
- [connection.rs:92-108](file://backend/src/handlers/connection.rs#L92-L108)

### Connection Pooling Best Practices
- Enable WAL mode for better concurrency with SQLite
- Configure busy_timeout to handle temporary locks gracefully
- Use a single pool per process for a given database file
- Avoid opening multiple pools to the same file simultaneously

Observed configuration:
- WAL mode enabled
- busy_timeout set to a reasonable duration
- Optional verification of journal_mode post-connect

**Section sources**
- [connection.rs:85-108](file://backend/src/handlers/connection.rs#L85-L108)
- [connection.rs:131-144](file://backend/src/handlers/connection.rs#L131-L144)

### Performance Implications
- Read-heavy workloads benefit from RwLock allowing concurrent readers
- Write operations (pool creation/replacement) are serialized
- Using a pooled connection avoids repeated open/close overhead
- WAL mode improves concurrent read/write throughput compared to default mode

Trade-offs:
- RwLock introduces small synchronization overhead
- Excessive writes (frequent reconnections) increase contention
- Long-running queries hold read locks briefly but do not block other readers

[No sources needed since this section provides general guidance]

### Extending AppState for Additional Shared Resources
To add more shared state:
- Add fields to AppState
- Wrap each mutable resource in Arc<RwLock<T>> if it needs concurrent access
- Initialize fields in main during AppState construction
- Extract State<AppState> in handlers and use read()/write() as appropriate

Example extension pattern:
- Add cache: Arc<RwLock<HashMap<String, Vec<u8>>>>
- Add config: Arc<RwLock<AppConfig>>
- Initialize in main and access in handlers via read/write locks

Guidelines:
- Prefer immutable data behind Arc where possible
- Minimize write lock scope
- Document ownership and lifetime expectations

[No sources needed since this section provides general guidance]

## Dependency Analysis
External dependencies relevant to state and pooling:
- axum: routing, middleware, State extractor
- tokio: async runtime and RwLock
- sqlx: database driver and connection pooling for SQLite
- tower-http: tracing layer and static file serving

```mermaid
graph LR
Axum["axum"] --> Main["main.rs"]
Tokio["tokio::sync::RwLock"] --> State["state.rs"]
Sqlx["sqlx::SqlitePool"] --> Conn["handlers/connection.rs"]
Tower["tower-http"] --> Main
```

**Diagram sources**
- [Cargo.toml:6-18](file://backend/Cargo.toml#L6-L18)
- [main.rs:1-17](file://backend/src/main.rs#L1-L17)
- [state.rs:1-8](file://backend/src/state.rs#L1-L8)
- [connection.rs:1-10](file://backend/src/handlers/connection.rs#L1-L10)

**Section sources**
- [Cargo.toml:6-18](file://backend/Cargo.toml#L6-L18)
- [main.rs:1-17](file://backend/src/main.rs#L1-L17)

## Performance Considerations
- Use read locks for query execution to maximize concurrency
- Batch operations where possible to reduce lock acquisitions
- Monitor slow queries and consider indexing or query optimization
- Tune busy_timeout based on expected contention levels
- Avoid frequent reconnections; reuse the pool across requests

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- “Database not connected”:
  - Ensure /api/connect has been called successfully
  - Verify the database file path and permissions
- WAL mode mismatch:
  - Confirm WAL mode is enabled and verified post-connect
- Busy errors:
  - Increase busy_timeout or reduce concurrent writers
- High CPU or latency:
  - Profile long-running queries
  - Reduce unnecessary reconnections

Operational checks:
- Inspect logs for connection errors and WAL verification warnings
- Validate that the db directory exists and is writable
- Confirm that only one process holds the active pool for a given file

**Section sources**
- [connection.rs:62-108](file://backend/src/handlers/connection.rs#L62-L108)
- [connection.rs:131-144](file://backend/src/handlers/connection.rs#L131-L144)
- [query.rs:101-200](file://backend/src/handlers/query.rs#L101-L200)

## Conclusion
The AppState design leverages Arc<RwLock<Option<SqlitePool>>> to provide safe, concurrent access to a SQLite connection pool across multiple handlers. The connection lifecycle is clearly separated: initialization occurs on demand via a dedicated endpoint, and subsequent handlers read from the pool using read locks. This approach balances simplicity with safety and performance. By following the recommended practices—short write scopes, WAL mode, busy_timeout, and careful pool management—you can extend the state structure and scale the application effectively.

[No sources needed since this section summarizes without analyzing specific files]

## Appendices

### API Endpoints Related to State and Pooling
- POST /api/connect
  - Purpose: Connect to a SQLite file and store the pool in AppState
  - Behavior: Validates path, creates db directory if needed, builds options (WAL + busy_timeout), creates pool, verifies WAL mode, and sets AppState.db
- GET /api/db-files
  - Purpose: List available .db files under the db directory
- GET /api/tables
  - Purpose: List tables from the currently connected database
- POST /api/query
  - Purpose: Execute SQL against the current pool and return results

**Section sources**
- [main.rs:52-65](file://backend/src/main.rs#L52-L65)
- [connection.rs:20-108](file://backend/src/handlers/connection.rs#L20-L108)
- [connection.rs:111-129](file://backend/src/handlers/connection.rs#L111-L129)
- [query.rs:101-200](file://backend/src/handlers/query.rs#L101-L200)