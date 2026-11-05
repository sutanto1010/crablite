use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenTabItem {
    pub id: String,
    pub name: String,
    pub sql: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenTabsState {
    pub db_path: String,
    pub tabs: Vec<OpenTabItem>,
    pub active_tab_id: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct GetOpenTabsParams {
    pub db: String,
}

#[derive(Debug, Deserialize)]
pub struct PutOpenTabsRequest {
    pub db_path: String,
    pub tabs: Vec<OpenTabItem>,
    pub active_tab_id: String,
}

pub async fn init_open_tabs_db(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS open_tabs (
            db_path TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn sanitize_tabs(mut tabs: Vec<OpenTabItem>, active_tab_id: &str) -> Option<(Vec<OpenTabItem>, String)> {
    let mut seen = std::collections::HashSet::new();
    let mut clean: Vec<OpenTabItem> = Vec::new();
    for t in tabs.drain(..).take(20) {
        let id = t.id.trim().to_string();
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        let name = t.name.trim().chars().take(100).collect::<String>();
        let sql = t.sql.chars().take(100_000).collect::<String>();
        clean.push(OpenTabItem {
            id,
            name: if name.is_empty() { "Query".to_string() } else { name },
            sql,
        });
    }
    if clean.is_empty() {
        return None;
    }
    let active = if seen.contains(active_tab_id) {
        active_tab_id.to_string()
    } else {
        clean[0].id.clone()
    };
    Some((clean, active))
}

pub async fn get_open_tabs(
    State(state): State<AppState>,
    Query(params): Query<GetOpenTabsParams>,
) -> Result<Json<OpenTabsState>, StatusCode> {
    let db = params.db.trim();
    if db.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let row: Option<(String, String, String)> =
        sqlx::query_as("SELECT db_path, payload, updated_at FROM open_tabs WHERE db_path = ?")
            .bind(db)
            .fetch_optional(&state.metadata_db)
            .await
            .map_err(|e| {
                tracing::error!("Failed to fetch open tabs: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
    match row {
        None => Err(StatusCode::NOT_FOUND),
        Some((db_path, payload, updated_at)) => {
            let parsed: serde_json::Value =
                serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null);
            let tabs_json = parsed.get("tabs").cloned().unwrap_or(serde_json::Value::Null);
            let active_json = parsed
                .get("active_tab_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let tabs: Vec<OpenTabItem> = serde_json::from_value(tabs_json).unwrap_or_default();
            match sanitize_tabs(tabs, &active_json) {
                None => Err(StatusCode::NOT_FOUND),
                Some((tabs, active_tab_id)) => Ok(Json(OpenTabsState {
                    db_path,
                    tabs,
                    active_tab_id,
                    updated_at,
                })),
            }
        }
    }
}

pub async fn put_open_tabs(
    State(state): State<AppState>,
    Json(payload): Json<PutOpenTabsRequest>,
) -> Result<Json<OpenTabsState>, (StatusCode, &'static str)> {
    let db_path = payload.db_path.trim().to_string();
    if db_path.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "db_path must not be empty"));
    }
    let Some((tabs, active_tab_id)) = sanitize_tabs(payload.tabs, &payload.active_tab_id) else {
        return Err((StatusCode::BAD_REQUEST, "tabs must not be empty"));
    };
    let stored_payload = serde_json::json!({ "tabs": tabs, "active_tab_id": active_tab_id });
    let stored_str = serde_json::to_string(&stored_payload)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Encode error"))?;

    let row: (String, String) = sqlx::query_as(
        r#"
        INSERT INTO open_tabs (db_path, payload, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(db_path) DO UPDATE SET payload = excluded.payload, updated_at = datetime('now')
        RETURNING payload, updated_at
        "#,
    )
    .bind(&db_path)
    .bind(&stored_str)
    .fetch_one(&state.metadata_db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to save open tabs: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Database error")
    })?;

    let parsed: serde_json::Value = serde_json::from_str(&row.0).unwrap_or(serde_json::json!({}));
    let out_tabs: Vec<OpenTabItem> = serde_json::from_value(
        parsed.get("tabs").cloned().unwrap_or(serde_json::Value::Null),
    )
    .unwrap_or_default();
    let out_active = parsed
        .get("active_tab_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok(Json(OpenTabsState {
        db_path,
        tabs: out_tabs,
        active_tab_id: out_active,
        updated_at: row.1,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::{Query, State};

    async fn test_state() -> AppState {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        init_open_tabs_db(&pool).await.unwrap();
        AppState::for_test(pool)
    }

    #[tokio::test]
    async fn test_open_tabs_roundtrip_per_db() {
        let state = test_state().await;

        // 1. Missing -> 404
        let missing = get_open_tabs(
            State(state.clone()),
            Query(GetOpenTabsParams {
                db: "a.db".to_string(),
            }),
        )
        .await;
        assert_eq!(missing.unwrap_err(), StatusCode::NOT_FOUND);

        // 2. Put tabs for a.db
        let saved = put_open_tabs(
            State(state.clone()),
            Json(PutOpenTabsRequest {
                db_path: "a.db".to_string(),
                tabs: vec![
                    OpenTabItem {
                        id: "t1".to_string(),
                        name: "Query 1".to_string(),
                        sql: "SELECT 1".to_string(),
                    },
                    OpenTabItem {
                        id: "t2".to_string(),
                        name: "Query 2".to_string(),
                        sql: "SELECT 2".to_string(),
                    },
                ],
                active_tab_id: "t2".to_string(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(saved.tabs.len(), 2);
        assert_eq!(saved.active_tab_id, "t2");

        // 3. Get returns same
        let fetched = get_open_tabs(
            State(state.clone()),
            Query(GetOpenTabsParams {
                db: "a.db".to_string(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(fetched.tabs.len(), 2);
        assert_eq!(fetched.active_tab_id, "t2");

        // 4. Other DB isolated
        let missing_b = get_open_tabs(
            State(state.clone()),
            Query(GetOpenTabsParams {
                db: "b.db".to_string(),
            }),
        )
        .await;
        assert_eq!(missing_b.unwrap_err(), StatusCode::NOT_FOUND);

        // 5. Overwrite (last-write-wins)
        let saved2 = put_open_tabs(
            State(state.clone()),
            Json(PutOpenTabsRequest {
                db_path: "a.db".to_string(),
                tabs: vec![OpenTabItem {
                    id: "t3".to_string(),
                    name: "Query 3".to_string(),
                    sql: "SELECT 3".to_string(),
                }],
                active_tab_id: "t3".to_string(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(saved2.tabs.len(), 1);

        // 6. Empty tabs rejected
        let empty = put_open_tabs(
            State(state.clone()),
            Json(PutOpenTabsRequest {
                db_path: "a.db".to_string(),
                tabs: vec![],
                active_tab_id: "".to_string(),
            }),
        )
        .await;
        assert!(empty.is_err());
    }
}
