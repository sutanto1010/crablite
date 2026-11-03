use axum::{
    Router,
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod handlers;
mod state;

use handlers::{
    connect_db, correct_sql, create_saved_query, delete_saved_query, execute_query,
    get_auth_config, get_database_schema, get_sqlite_internals, get_table_schema, health_check,
    init_metadata_db, list_dbs, list_saved_queries, list_tables, login, logout, update_saved_query,
    verify_session_cookie,
};
use state::AppState;

async fn auth_middleware(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // 1. Check signed session cookie
    if let Some(cookie_header) = headers
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
    {
        if verify_session_cookie(cookie_header, &state.session_secret) {
            return Ok(next.run(request).await);
        }
    }

    // 2. Fall back to x-api-key header for direct API calls / CLI
    if let Some(key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        if key == state.api_key {
            return Ok(next.run(request).await);
        }
    }

    Err(StatusCode::UNAUTHORIZED)
}

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();

    // 初始化日志
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "crablite=debug,tower_http=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let db_dir = std::env::var_os("DB_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("db"));

    let api_key =
        std::env::var("API_KEY").unwrap_or_else(|_| "your-super-secure-key".to_string());
    let turnstile_secret_key = std::env::var("TURNSTILE_SECRET_KEY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let turnstile_site_key = std::env::var("TURNSTILE_SITE_KEY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let session_secret = std::env::var("SESSION_SECRET")
        .map(|s| s.into_bytes())
        .unwrap_or_else(|_| {
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(api_key.as_bytes());
            hasher.update(b"crablite-session-salt");
            hasher.finalize().to_vec()
        });

    if turnstile_secret_key.is_some() && turnstile_site_key.is_some() {
        tracing::info!("Cloudflare Turnstile enabled");
    } else {
        tracing::info!("Cloudflare Turnstile disabled (optional TURNSTILE_SECRET_KEY / TURNSTILE_SITE_KEY not configured)");
    }

    if let Err(e) = std::fs::create_dir_all(&db_dir) {
        tracing::error!("Failed to create db directory: {}", e);
    }

    let metadata_db_path = db_dir.join(".crablite_metadata.db");
    let metadata_options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&metadata_db_path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .busy_timeout(std::time::Duration::from_secs(30));

    let metadata_pool = sqlx::SqlitePool::connect_with(metadata_options)
        .await
        .expect("Failed to connect to metadata database");

    init_metadata_db(&metadata_pool)
        .await
        .expect("Failed to initialize metadata tables");

    let state = AppState {
        db: Arc::new(RwLock::new(None)),
        metadata_db: metadata_pool,
        db_dir,
        api_key,
        turnstile_secret_key,
        turnstile_site_key,
        session_secret,
        http_client: reqwest::Client::new(),
    };
    tracing::info!("database directory: {}", state.db_dir.display());

    // 构建应用路由
    let auth_routes = Router::new()
        .route("/config", get(get_auth_config))
        .route("/login", post(login))
        .route("/logout", post(logout));

    let protected_routes = Router::new()
        .route("/connect", post(connect_db))
        .route("/db-files", get(list_dbs))
        .route("/tables", get(list_tables))
        .route("/schema", get(get_database_schema))
        .route("/schema/table", get(get_table_schema))
        .route("/internals", get(get_sqlite_internals))
        .route("/query", post(execute_query))
        .route("/correct", post(correct_sql))
        .route("/saved-queries", get(list_saved_queries).post(create_saved_query))
        .route(
            "/saved-queries/{id}",
            axum::routing::put(update_saved_query).delete(delete_saved_query),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    let app = Router::new()
        .route("/api/health", get(health_check))
        .nest("/api/auth", auth_routes)
        .nest("/api", protected_routes)
        .fallback_service(ServeDir::new("dist"))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // 绑定端口
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "3000".to_string())
        .parse::<u16>()
        .expect("PORT must be a valid port number");
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
