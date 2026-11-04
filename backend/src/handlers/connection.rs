use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use crate::state::AppState;
use std::path::Path;

#[derive(Deserialize)]
pub struct ConnectRequest {
    pub path: String,
    #[serde(default)]
    pub create: bool,
}

#[derive(serde::Serialize)]
pub struct DbFileInfo {
    pub path: String,
    pub size_bytes: u64,
    pub modified_at: Option<String>,
}

pub async fn list_dbs(State(state): State<AppState>) -> impl IntoResponse {
    let db_dir = &state.db_dir;
    if !db_dir.exists() {
        if let Err(e) = std::fs::create_dir_all(db_dir) {
             tracing::error!("Failed to create db directory: {}", e);
             return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create db directory").into_response();
        }
        return Json(Vec::<String>::new()).into_response();
    }

    let mut files: Vec<DbFileInfo> = Vec::new();

    // Recursively scan all subdirectories for .db files
    fn scan_db_files(dir: &Path, root: &Path, result: &mut Vec<DbFileInfo>) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Ok(file_type) = entry.file_type() {
                    if let Some(name) = entry.file_name().to_str() {
                        // Exclude hidden files / metadata files / hidden directories
                        if name.starts_with('.') {
                            continue;
                        }
                        if file_type.is_file() {
                            // Exclude WAL/SHM files and only match .db extension
                            if !name.ends_with("-wal") && !name.ends_with("-shm")
                               && name.ends_with(".db") {
                                // Record paths relative to the configured database directory
                                if let Ok(rel) = path.strip_prefix(root) {
                                    let metadata = std::fs::metadata(&path).ok();
                                    let modified_at = metadata
                                        .as_ref()
                                        .and_then(|m| m.modified().ok())
                                        .and_then(|t| chrono_timestamp(t));
                                    result.push(DbFileInfo {
                                        path: rel.to_string_lossy().to_string(),
                                        size_bytes: metadata.map(|m| m.len()).unwrap_or(0),
                                        modified_at,
                                    });
                                }
                            }
                        } else if file_type.is_dir() {
                            // Recurse into subdirectories
                            scan_db_files(&path, root, result);
                        }
                    }
                }
            }
        }
    }

    scan_db_files(db_dir, db_dir, &mut files);
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Json(files).into_response()
}

fn chrono_timestamp(t: std::time::SystemTime) -> Option<String> {
    t.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs().to_string())
}

fn resolve_db_path(db_dir: &Path, raw: &str) -> Result<std::path::PathBuf, (StatusCode, &'static str)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.contains("..") {
        return Err((StatusCode::BAD_REQUEST, "Invalid path: directory traversal not allowed"));
    }
    if !trimmed.ends_with(".db") {
        return Err((StatusCode::BAD_REQUEST, "Only .db files are supported"));
    }
    Ok(db_dir.join(trimmed))
}

pub async fn replace_db_file(
    State(state): State<AppState>,
    axum::extract::Path(path): axum::extract::Path<String>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    if body.is_empty() || body.len() > 256 * 1024 * 1024 {
        return (StatusCode::BAD_REQUEST, "Empty or oversized upload (max 256 MiB)").into_response();
    }
    let full = match resolve_db_path(&state.db_dir, &path) {
        Ok(p) => p,
        Err(e) => return e.into_response(),
    };
    if let Some(parent) = full.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::error!("Failed to create db directory: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create db directory").into_response();
        }
    }
    // Validate that the payload is a SQLite database (magic header).
    if body.len() < 16 || &body[0..16] != b"SQLite format 3\0" {
        return (StatusCode::BAD_REQUEST, "Upload is not a valid SQLite database").into_response();
    }
    if let Err(e) = std::fs::write(&full, &body) {
        tracing::error!("Failed to write db file: {}", e);
        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to write database file").into_response();
    }
    // Remove stale WAL/SHM sidecars so the new file opens cleanly.
    for suffix in ["-wal", "-shm", "-journal"] {
        let sidecar = std::path::PathBuf::from(format!("{}{suffix}", full.display()));
        let _ = std::fs::remove_file(sidecar);
    }
    (StatusCode::CREATED, "Uploaded").into_response()
}

pub async fn delete_db_file(
    State(state): State<AppState>,
    axum::extract::Path(path): axum::extract::Path<String>,
) -> impl IntoResponse {
    let full = match resolve_db_path(&state.db_dir, &path) {
        Ok(p) => p,
        Err(e) => return e.into_response(),
    };
    match std::fs::remove_file(&full) {
        Ok(()) => {
            for suffix in ["-wal", "-shm", "-journal"] {
                let sidecar = std::path::PathBuf::from(format!("{}{suffix}", full.display()));
                let _ = std::fs::remove_file(sidecar);
            }
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            (StatusCode::NOT_FOUND, "Database file not found").into_response()
        }
        Err(e) => {
            tracing::error!("Failed to delete db file: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete database file").into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct RenameDbRequest {
    pub from: String,
    pub to: String,
}

pub async fn rename_db_file(
    State(state): State<AppState>,
    Json(payload): Json<RenameDbRequest>,
) -> impl IntoResponse {
    let from = match resolve_db_path(&state.db_dir, &payload.from) {
        Ok(p) => p,
        Err(e) => return e.into_response(),
    };
    let to = match resolve_db_path(&state.db_dir, &payload.to) {
        Ok(p) => p,
        Err(e) => return e.into_response(),
    };
    if to.exists() {
        return (StatusCode::CONFLICT, "Target database file already exists").into_response();
    }
    if let Some(parent) = to.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::error!("Failed to create db directory: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create db directory").into_response();
        }
    }
    match std::fs::rename(&from, &to) {
        Ok(()) => (StatusCode::OK, "Renamed").into_response(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            (StatusCode::NOT_FOUND, "Database file not found").into_response()
        }
        Err(e) => {
            tracing::error!("Failed to rename db file: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to rename database file").into_response()
        }
    }
}

pub async fn connect_db(
    State(state): State<AppState>,
    Json(payload): Json<ConnectRequest>,
) -> impl IntoResponse {
    // Security check: allow subdirectory paths, only block directory traversal
    if payload.path.contains("..") {
         return (StatusCode::BAD_REQUEST, "Invalid path: directory traversal not allowed").into_response();
    }

    let db_dir = &state.db_dir;
    if !db_dir.exists() {
         if let Err(e) = std::fs::create_dir_all(db_dir) {
             tracing::error!("Failed to create db directory: {}", e);
             return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create db directory").into_response();
        }
    }

    let full_path = db_dir.join(&payload.path);

    if !full_path.exists() && !payload.create {
        return (StatusCode::NOT_FOUND, "Database file not found").into_response();
    }
    
    let options = SqliteConnectOptions::new()
        .filename(&full_path)
        .create_if_missing(payload.create)
        .journal_mode(SqliteJournalMode::Wal)
        // 关键：设置并发访问超时，防止多进程竞争导致数据库损坏
        .busy_timeout(std::time::Duration::from_secs(30));
    
    match SqlitePool::connect_with(options).await {
        Ok(pool) => {
            // Optional: Verify WAL mode
            if let Err(e) = verify_wal_mode(&pool).await {
                tracing::warn!("WAL mode verification failed: {}", e);
            }
            
            let mut db = state.db.write().await;
            *db = Some(pool);
            tracing::info!("Connected to database: {:?}", full_path);
            (StatusCode::OK, "Connected").into_response()
        }
        Err(e) => {
            tracing::error!("Failed to connect: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to connect: {}", e)).into_response()
        }
    }
}

pub async fn list_tables(State(state): State<AppState>) -> impl IntoResponse {
    let db = state.db.read().await;

    if let Some(pool) = db.as_ref() {
        let query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
        match sqlx::query_scalar::<_, String>(query)
            .fetch_all(pool)
            .await 
        {
            Ok(tables) => Json(tables).into_response(),
            Err(e) => {
                tracing::error!("Failed to fetch tables: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch tables").into_response()
            }
        }
    } else {
        (StatusCode::BAD_REQUEST, "No database connected").into_response()
    }
}

/// Verify WAL mode is working correctly after connection.
/// SQLite WAL mode requires three files: .db, .db-wal, .db-shm
pub async fn verify_wal_mode(pool: &SqlitePool) -> Result<(), String> {
    let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to check journal_mode: {}", e))?;

    if mode != "wal" {
        return Err(format!("Expected WAL mode, got: {}", mode));
    }

    Ok(())
}
