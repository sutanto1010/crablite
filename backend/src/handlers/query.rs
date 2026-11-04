use axum::{
    extract::State,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Column, Row, TypeInfo};
use sqlx::sqlite::SqliteRow;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct QueryRequest {
    pub sql: String,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

#[derive(Serialize)]
pub struct QueryResponse {
    pub columns: Vec<String>,
    pub column_types: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub affected_rows: Option<u64>,
    pub execution_time: f64,
    pub error: Option<String>,
    pub total_rows: Option<i64>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

const DEFAULT_PAGE_SIZE: i64 = 100;
const MAX_PAGE_SIZE: i64 = 1000;

async fn count_total_rows(pool: &sqlx::SqlitePool, sql: &str) -> Option<i64> {
    let count_sql = format!(
        "SELECT COUNT(*) FROM ({}) AS _crablite_count",
        sql.trim_end_matches(';')
    );
    sqlx::query_scalar::<_, i64>(&count_sql)
        .fetch_one(pool)
        .await
        .ok()
}

fn serialize_row(row: &SqliteRow) -> Vec<Value> {
    let mut row_data = Vec::new();
    for (i, _) in row.columns().iter().enumerate() {
        let col = row.column(i);
        let type_info = col.type_info();
        let type_name = type_info.name();
        
        let val: Value = if type_name == "NULL" {
            if let Ok(v) = row.try_get::<String, _>(i) {
                Value::String(v)
            } else if let Ok(v) = row.try_get::<i64, _>(i) {
                Value::Number(v.into())
            } else {
                Value::Null
            }
        } else if type_name == "INTEGER" || type_name == "INT" || type_name == "BIGINT" || type_name == "int8" {
            match row.try_get::<i64, _>(i) {
                Ok(v) => Value::Number(v.into()),
                Err(_) => {
                    match row.try_get::<String, _>(i) {
                        Ok(v) => Value::String(v),
                        Err(_) => Value::Null,
                    }
                },
            }
        } else if type_name == "REAL" || type_name == "FLOAT" || type_name == "DOUBLE" {
            match row.try_get::<f64, _>(i) {
                Ok(v) => {
                    if let Some(n) = serde_json::Number::from_f64(v) {
                        Value::Number(n)
                    } else {
                        Value::Null 
                    }
                },
                Err(_) => {
                    match row.try_get::<String, _>(i) {
                        Ok(v) => Value::String(v),
                        Err(_) => Value::Null,
                    }
                },
            }
        } else if type_name == "BOOLEAN" || type_name == "BOOL" {
            match row.try_get::<bool, _>(i) {
                Ok(v) => Value::Bool(v),
                Err(_) => {
                    match row.try_get::<String, _>(i) {
                        Ok(v) => Value::String(v),
                        Err(_) => Value::Null,
                    }
                },
            }
        } else if type_name == "BLOB" {
            match row.try_get::<Vec<u8>, _>(i) {
                Ok(v) => {
                    let hex: String = v.iter().map(|b| format!("{:02X}", b)).collect();
                    Value::String(format!("x'{}'", hex))
                },
                Err(_) => Value::Null,
            }
        } else {
            match row.try_get::<String, _>(i) {
                Ok(v) => Value::String(v),
                Err(_) => {
                    // Fallback: try to convert whatever it is to string if possible, or use a placeholder
                    Value::String(format!("[{}]", type_name))
                }
            }
        };
        row_data.push(val);
    }
    row_data
}

pub async fn execute_query(
    State(state): State<AppState>,
    Json(payload): Json<QueryRequest>,
) -> impl IntoResponse {
    tracing::info!("Executing query: {}", payload.sql);

    let empty_page = |total_rows: Option<i64>, limit: Option<i64>, offset: Option<i64>| QueryResponse {
        columns: vec![],
        column_types: vec![],
        rows: vec![],
        affected_rows: None,
        execution_time: 0.0,
        error: Some("Database not connected".to_string()),
        total_rows,
        limit,
        offset,
    };

    let db = state.db.read().await;
    let pool = match &*db {
        Some(pool) => pool,
        None => {
            return Json(empty_page(None, None, None));
        }
    };

    let start = std::time::Instant::now();
    let sql_upper = payload.sql.trim().to_uppercase();
    let return_rows = sql_upper.starts_with("SELECT") 
        || sql_upper.starts_with("PRAGMA") 
        || sql_upper.starts_with("EXPLAIN") 
        || sql_upper.starts_with("WITH")
        || sql_upper.contains("RETURNING");

    if return_rows {
        let limit = payload.limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
        let offset = payload.offset.unwrap_or(0).max(0);
        let paged_sql = format!("SELECT * FROM ({}) AS _crablite_sub LIMIT ? OFFSET ?", payload.sql.trim_end_matches(';'));
        let result = sqlx::query(&paged_sql).bind(limit).bind(offset).fetch_all(pool).await;
        let execution_time = start.elapsed().as_secs_f64() * 1000.0;

        match result {
            Ok(rows) => {
                if rows.is_empty() {
                    // Still try to compute total for empty pages.
                    let total_rows = count_total_rows(pool, &payload.sql).await;
                    return Json(QueryResponse {
                        columns: vec![],
                        column_types: vec![],
                        rows: vec![],
                        affected_rows: None,
                        execution_time,
                        error: None,
                        total_rows,
                        limit: Some(limit),
                        offset: Some(offset),
                    });
                }

                let columns: Vec<String> = rows[0].columns().iter().map(|c| c.name().to_string()).collect();
                let column_types: Vec<String> = rows[0].columns().iter().map(|c| c.type_info().name().to_string()).collect();

                // Use the helper function to map rows
                let data: Vec<Vec<Value>> = rows.iter().map(serialize_row).collect();
                let total_rows = count_total_rows(pool, &payload.sql).await;

                Json(QueryResponse {
                    columns,
                    column_types,
                    rows: data,
                    affected_rows: None,
                    execution_time,
                    error: None,
                    total_rows,
                    limit: Some(limit),
                    offset: Some(offset),
                })
            }
            Err(e) => {
                Json(QueryResponse {
                    columns: vec![],
                    column_types: vec![],
                    rows: vec![],
                    affected_rows: None,
                    execution_time,
                    error: Some(e.to_string()),
                    total_rows: None,
                    limit: None,
                    offset: None,
                })
            }
        }
    } else {
        let result = sqlx::query(&payload.sql).execute(pool).await;
        let execution_time = start.elapsed().as_secs_f64() * 1000.0;

        match result {
            Ok(result) => {
                Json(QueryResponse {
                    columns: vec![],
                    column_types: vec![],
                    rows: vec![],
                    affected_rows: Some(result.rows_affected()),
                    execution_time,
                    error: None,
                    total_rows: None,
                    limit: None,
                    offset: None,
                })
            }
            Err(e) => {
                Json(QueryResponse {
                    columns: vec![],
                    column_types: vec![],
                    rows: vec![],
                    affected_rows: None,
                    execution_time,
                    error: Some(e.to_string()),
                    total_rows: None,
                    limit: None,
                    offset: None,
                })
            }
        }
    }
}
