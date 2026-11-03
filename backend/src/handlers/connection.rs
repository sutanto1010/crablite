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

pub async fn list_dbs(State(state): State<AppState>) -> impl IntoResponse {
    let db_dir = &state.db_dir;
    if !db_dir.exists() {
        if let Err(e) = std::fs::create_dir_all(db_dir) {
             tracing::error!("Failed to create db directory: {}", e);
             return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create db directory").into_response();
        }
        return Json(Vec::<String>::new()).into_response();
    }

    let mut files = Vec::new();

    // Recursively scan all subdirectories for .db files
    fn scan_db_files(dir: &Path, root: &Path, result: &mut Vec<String>) {
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
                                    result.push(rel.to_string_lossy().to_string());
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
    Json(files).into_response()
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
