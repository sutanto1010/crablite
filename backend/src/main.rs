use axum::{
    Router,
    extract::Request,
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
    connect_db, correct_sql, execute_query, get_database_schema, get_sqlite_internals,
    get_table_schema, health_check, list_dbs, list_tables,
};
use state::AppState;

async fn auth_middleware(
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let api_key = std::env::var("API_KEY").unwrap_or_else(|_| "your-super-secure-key".to_string());

    match headers.get("x-api-key") {
        Some(key) if key == api_key.as_str() => Ok(next.run(request).await),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
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
    let state = AppState {
        db: Arc::new(RwLock::new(None)),
        db_dir,
    };
    tracing::info!("database directory: {}", state.db_dir.display());

    // 构建应用路由
    let api_routes = Router::new()
        .route("/connect", post(connect_db))
        .route("/db-files", get(list_dbs))
        .route("/tables", get(list_tables))
        .route("/schema", get(get_database_schema))
        .route("/schema/table", get(get_table_schema))
        .route("/internals", get(get_sqlite_internals))
        .route("/query", post(execute_query))
        .route("/correct", post(correct_sql))
        .layer(middleware::from_fn(auth_middleware));

    let app = Router::new()
        .route("/api/health", get(health_check))
        .nest("/api", api_routes)
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
