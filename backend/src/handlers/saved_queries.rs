use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow, PartialEq, Eq)]
pub struct SavedQuery {
    pub id: i64,
    pub db_path: String,
    pub name: String,
    pub query: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct ListSavedQueriesParams {
    pub db: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateSavedQueryRequest {
    pub db_path: String,
    pub name: String,
    pub query: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSavedQueryRequest {
    pub name: Option<String>,
    pub query: Option<String>,
}

pub async fn init_metadata_db(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS saved_queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            db_path TEXT NOT NULL,
            name TEXT NOT NULL,
            query TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_saved_queries_db_path ON saved_queries (db_path);
        "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_saved_queries(
    State(state): State<AppState>,
    Query(params): Query<ListSavedQueriesParams>,
) -> Result<Json<Vec<SavedQuery>>, StatusCode> {
    let db = params.db.trim();
    if db.is_empty() {
        return Ok(Json(Vec::new()));
    }

    let queries = sqlx::query_as::<_, SavedQuery>(
        r#"
        SELECT id, db_path, name, query, created_at, updated_at
        FROM saved_queries
        WHERE db_path = ?
        ORDER BY updated_at DESC, id DESC
        "#,
    )
    .bind(db)
    .fetch_all(&state.metadata_db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch saved queries: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(queries))
}

pub async fn create_saved_query(
    State(state): State<AppState>,
    Json(payload): Json<CreateSavedQueryRequest>,
) -> Result<(StatusCode, Json<SavedQuery>), (StatusCode, &'static str)> {
    let db_path = payload.db_path.trim();
    let name = payload.name.trim();
    let query = payload.query.trim();

    if db_path.is_empty() || name.is_empty() || query.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "db_path, name, and query must not be empty"));
    }

    let saved = sqlx::query_as::<_, SavedQuery>(
        r#"
        INSERT INTO saved_queries (db_path, name, query, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
        RETURNING id, db_path, name, query, created_at, updated_at
        "#,
    )
    .bind(db_path)
    .bind(name)
    .bind(query)
    .fetch_one(&state.metadata_db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert saved query: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Database error")
    })?;

    Ok((StatusCode::CREATED, Json(saved)))
}

pub async fn update_saved_query(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(payload): Json<UpdateSavedQueryRequest>,
) -> Result<Json<SavedQuery>, (StatusCode, &'static str)> {
    let name = payload.name.as_deref().map(str::trim);
    let query = payload.query.as_deref().map(str::trim);

    if matches!(name, Some(n) if n.is_empty()) {
        return Err((StatusCode::BAD_REQUEST, "name cannot be empty"));
    }
    if matches!(query, Some(q) if q.is_empty()) {
        return Err((StatusCode::BAD_REQUEST, "query cannot be empty"));
    }

    if name.is_none() && query.is_none() {
        return Err((StatusCode::BAD_REQUEST, "Nothing to update"));
    }

    let updated = sqlx::query_as::<_, SavedQuery>(
        r#"
        UPDATE saved_queries
        SET name = COALESCE(?, name),
            query = COALESCE(?, query),
            updated_at = datetime('now')
        WHERE id = ?
        RETURNING id, db_path, name, query, created_at, updated_at
        "#,
    )
    .bind(name)
    .bind(query)
    .bind(id)
    .fetch_optional(&state.metadata_db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update saved query: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Database error")
    })?;

    match updated {
        Some(item) => Ok(Json(item)),
        None => Err((StatusCode::NOT_FOUND, "Saved query not found")),
    }
}

pub async fn delete_saved_query(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    let result = sqlx::query("DELETE FROM saved_queries WHERE id = ?")
        .bind(id)
        .execute(&state.metadata_db)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete saved query: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if result.rows_affected() == 0 {
        Err(StatusCode::NOT_FOUND)
    } else {
        Ok(StatusCode::NO_CONTENT)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_state() -> AppState {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        init_metadata_db(&pool).await.unwrap();
        AppState::for_test(pool)
    }

    #[tokio::test]
    async fn test_saved_queries_crud_lifecycle() {
        let state = test_state().await;

        // 1. Initially empty
        let list = list_saved_queries(
            State(state.clone()),
            Query(ListSavedQueriesParams {
                db: "test.db".to_string(),
            }),
        )
        .await
        .unwrap();
        assert!(list.0.is_empty());

        // 2. Create saved query
        let (status, created) = create_saved_query(
            State(state.clone()),
            Json(CreateSavedQueryRequest {
                db_path: "test.db".to_string(),
                name: "Active Users".to_string(),
                query: "SELECT * FROM users WHERE active = 1".to_string(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.name, "Active Users");
        assert_eq!(created.db_path, "test.db");
        assert_eq!(created.query, "SELECT * FROM users WHERE active = 1");

        // 3. Create another saved query for a different database
        let (_status, _created_other) = create_saved_query(
            State(state.clone()),
            Json(CreateSavedQueryRequest {
                db_path: "other.db".to_string(),
                name: "Other Query".to_string(),
                query: "SELECT 1".to_string(),
            }),
        )
        .await
        .unwrap();

        // 4. List queries for "test.db" (should only return the test.db query)
        let list = list_saved_queries(
            State(state.clone()),
            Query(ListSavedQueriesParams {
                db: "test.db".to_string(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(list.0.len(), 1);
        assert_eq!(list.0[0].name, "Active Users");

        // 5. Update query
        let updated = update_saved_query(
            State(state.clone()),
            Path(created.id),
            Json(UpdateSavedQueryRequest {
                name: Some("All Active Users".to_string()),
                query: None,
            }),
        )
        .await
        .unwrap();
        assert_eq!(updated.0.name, "All Active Users");
        assert_eq!(updated.0.query, "SELECT * FROM users WHERE active = 1");

        // 6. Delete query
        let del_status = delete_saved_query(State(state.clone()), Path(created.id))
            .await
            .unwrap();
        assert_eq!(del_status, StatusCode::NO_CONTENT);

        // 7. List again - should be empty for test.db
        let list_after = list_saved_queries(
            State(state.clone()),
            Query(ListSavedQueriesParams {
                db: "test.db".to_string(),
            }),
        )
        .await
        .unwrap();
        assert!(list_after.0.is_empty());

        // 8. Delete non-existent returns 404
        let del_404 = delete_saved_query(State(state.clone()), Path(created.id)).await;
        assert_eq!(del_404.unwrap_err(), StatusCode::NOT_FOUND);
    }
}
