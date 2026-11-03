use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use sqlx::SqlitePool;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<RwLock<Option<SqlitePool>>>,
    pub metadata_db: SqlitePool,
    pub db_dir: PathBuf,
    pub api_key: String,
    pub turnstile_secret_key: Option<String>,
    pub turnstile_site_key: Option<String>,
    pub session_secret: Vec<u8>,
    pub http_client: reqwest::Client,
}

impl AppState {
    #[cfg(test)]
    pub fn for_test(pool: SqlitePool) -> Self {
        Self {
            db: Arc::new(RwLock::new(Some(pool.clone()))),
            metadata_db: pool,
            db_dir: PathBuf::new(),
            api_key: "test-api-key".to_string(),
            turnstile_secret_key: None,
            turnstile_site_key: None,
            session_secret: b"test-session-secret-key-12345678".to_vec(),
            http_client: reqwest::Client::new(),
        }
    }
}
