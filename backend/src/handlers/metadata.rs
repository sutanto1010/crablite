use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use sqlx::{Column, Row, SqliteConnection, SqlitePool};

use crate::state::AppState;

#[derive(Serialize)]
pub struct SchemaObject {
    pub object_type: String,
    pub name: String,
    pub table_name: String,
    pub sql: Option<String>,
}

#[derive(Serialize)]
pub struct DatabaseSchema {
    pub objects: Vec<SchemaObject>,
    pub ddl: String,
}

#[derive(Serialize)]
pub struct ColumnSchema {
    pub cid: i64,
    pub name: String,
    pub declared_type: String,
    pub not_null: bool,
    pub default_value: Option<String>,
    pub primary_key_position: i64,
    pub hidden: i64,
}

#[derive(Serialize)]
pub struct ForeignKeySchema {
    pub id: i64,
    pub sequence: i64,
    pub referenced_table: String,
    pub from: String,
    pub to: Option<String>,
    pub on_update: String,
    pub on_delete: String,
    pub match_type: String,
}

#[derive(Serialize)]
pub struct IndexColumn {
    pub name: Option<String>,
    pub descending: bool,
    pub collation: String,
}

#[derive(Serialize)]
pub struct IndexSchema {
    pub name: String,
    pub unique: bool,
    pub origin: String,
    pub partial: bool,
    pub columns: Vec<IndexColumn>,
}

#[derive(Serialize)]
pub struct TriggerSchema {
    pub name: String,
    pub sql: Option<String>,
}

#[derive(Serialize)]
pub struct TableSchema {
    pub name: String,
    pub sql: Option<String>,
    pub columns: Vec<ColumnSchema>,
    pub foreign_keys: Vec<ForeignKeySchema>,
    pub indexes: Vec<IndexSchema>,
    pub triggers: Vec<TriggerSchema>,
}

#[derive(Serialize)]
pub struct MetadataValue {
    pub name: String,
    pub values: Vec<String>,
}

#[derive(Serialize)]
pub struct SqliteSchemaEntry {
    pub object_type: String,
    pub name: String,
    pub table_name: String,
    pub root_page: i64,
    pub sql: Option<String>,
}

#[derive(Serialize)]
pub struct SqliteInternals {
    pub database: Vec<MetadataValue>,
    pub connection: Vec<MetadataValue>,
    pub engine: Vec<MetadataValue>,
    pub schema_entries: Vec<SqliteSchemaEntry>,
}

#[derive(Deserialize)]
pub struct TableSchemaQuery {
    pub name: String,
}

async fn load_schema_objects(pool: &SqlitePool) -> Result<Vec<SchemaObject>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT type, name, tbl_name, sql \
         FROM main.sqlite_schema \
         WHERE type IN ('table', 'view', 'index', 'trigger') \
           AND name NOT LIKE 'sqlite_%' \
         ORDER BY CASE type \
             WHEN 'table' THEN 1 WHEN 'view' THEN 2 \
             WHEN 'index' THEN 3 WHEN 'trigger' THEN 4 ELSE 5 END, name",
    )
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            Ok(SchemaObject {
                object_type: row.try_get("type")?,
                name: row.try_get("name")?,
                table_name: row.try_get("tbl_name")?,
                sql: row.try_get("sql")?,
            })
        })
        .collect()
}

fn combined_ddl(objects: &[SchemaObject]) -> String {
    let mut ddl = String::new();
    for sql in objects.iter().filter_map(|object| object.sql.as_deref()) {
        if !ddl.is_empty() {
            ddl.push_str("\n\n");
        }
        ddl.push_str(sql);
        if !sql.trim_end().ends_with(';') {
            ddl.push(';');
        }
    }
    ddl
}

async fn load_table_schema(
    pool: &SqlitePool,
    name: &str,
) -> Result<Option<TableSchema>, sqlx::Error> {
    let table =
        sqlx::query("SELECT sql FROM main.sqlite_schema WHERE type = 'table' AND name = ?1")
            .bind(name)
            .fetch_optional(pool)
            .await?;

    let Some(table) = table else {
        return Ok(None);
    };

    let column_rows = sqlx::query(
        "SELECT cid, name, type, \"notnull\", dflt_value, pk, hidden \
         FROM pragma_table_xinfo(?1, 'main') ORDER BY cid",
    )
    .bind(name)
    .fetch_all(pool)
    .await?;
    let columns = column_rows
        .into_iter()
        .map(|row| {
            Ok(ColumnSchema {
                cid: row.try_get("cid")?,
                name: row.try_get("name")?,
                declared_type: row.try_get("type")?,
                not_null: row.try_get::<i64, _>("notnull")? != 0,
                default_value: row.try_get("dflt_value")?,
                primary_key_position: row.try_get("pk")?,
                hidden: row.try_get("hidden")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;

    let foreign_key_rows = sqlx::query(
        "SELECT id, seq, \"table\", \"from\", \"to\", on_update, on_delete, \"match\" \
         FROM pragma_foreign_key_list(?1, 'main') ORDER BY id, seq",
    )
    .bind(name)
    .fetch_all(pool)
    .await?;
    let foreign_keys = foreign_key_rows
        .into_iter()
        .map(|row| {
            Ok(ForeignKeySchema {
                id: row.try_get("id")?,
                sequence: row.try_get("seq")?,
                referenced_table: row.try_get("table")?,
                from: row.try_get("from")?,
                to: row.try_get("to")?,
                on_update: row.try_get("on_update")?,
                on_delete: row.try_get("on_delete")?,
                match_type: row.try_get("match")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;

    let index_rows = sqlx::query(
        "SELECT name, \"unique\", origin, partial \
         FROM pragma_index_list(?1, 'main') ORDER BY seq",
    )
    .bind(name)
    .fetch_all(pool)
    .await?;
    let mut indexes = Vec::new();
    for row in index_rows {
        let index_name: String = row.try_get("name")?;
        let index_column_rows = sqlx::query(
            "SELECT name, \"desc\", coll FROM pragma_index_xinfo(?1, 'main') \
             WHERE key = 1 ORDER BY seqno",
        )
        .bind(&index_name)
        .fetch_all(pool)
        .await?;
        let index_columns = index_column_rows
            .into_iter()
            .map(|column| {
                Ok(IndexColumn {
                    name: column.try_get("name")?,
                    descending: column.try_get::<i64, _>("desc")? != 0,
                    collation: column.try_get("coll")?,
                })
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()?;
        indexes.push(IndexSchema {
            name: index_name,
            unique: row.try_get::<i64, _>("unique")? != 0,
            origin: row.try_get("origin")?,
            partial: row.try_get::<i64, _>("partial")? != 0,
            columns: index_columns,
        });
    }

    let trigger_rows = sqlx::query(
        "SELECT name, sql FROM main.sqlite_schema \
         WHERE type = 'trigger' AND tbl_name = ?1 ORDER BY name",
    )
    .bind(name)
    .fetch_all(pool)
    .await?;
    let triggers = trigger_rows
        .into_iter()
        .map(|row| {
            Ok(TriggerSchema {
                name: row.try_get("name")?,
                sql: row.try_get("sql")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;

    Ok(Some(TableSchema {
        name: name.to_string(),
        sql: table.try_get("sql")?,
        columns,
        foreign_keys,
        indexes,
        triggers,
    }))
}

fn format_pragma_row(row: &sqlx::sqlite::SqliteRow) -> Result<String, sqlx::Error> {
    let mut values = Vec::new();
    for (index, column) in row.columns().iter().enumerate() {
        let value = if let Ok(value) = row.try_get::<String, _>(index) {
            value
        } else if let Ok(value) = row.try_get::<i64, _>(index) {
            value.to_string()
        } else if let Ok(value) = row.try_get::<f64, _>(index) {
            value.to_string()
        } else {
            "null".to_string()
        };
        if row.columns().len() == 1 {
            values.push(value);
        } else {
            values.push(format!("{}={}", column.name(), value));
        }
    }
    Ok(values.join(" | "))
}

async fn read_pragma_group(
    connection: &mut SqliteConnection,
    names: &[&str],
) -> Result<Vec<MetadataValue>, sqlx::Error> {
    let mut group = Vec::new();
    for name in names {
        let rows = sqlx::query(&format!("PRAGMA main.{name}"))
            .fetch_all(&mut *connection)
            .await?;
        let values = rows
            .iter()
            .map(format_pragma_row)
            .collect::<Result<Vec<_>, sqlx::Error>>()?;
        group.push(MetadataValue {
            name: (*name).to_string(),
            values,
        });
    }
    Ok(group)
}

async fn load_schema_entries(
    connection: &mut SqliteConnection,
) -> Result<Vec<SqliteSchemaEntry>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT type, name, tbl_name, rootpage, sql FROM main.sqlite_schema \
         ORDER BY CASE WHEN name LIKE 'sqlite_%' THEN 0 ELSE 1 END, type, name",
    )
    .fetch_all(connection)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(SqliteSchemaEntry {
                object_type: row.try_get("type")?,
                name: row.try_get("name")?,
                table_name: row.try_get("tbl_name")?,
                root_page: row.try_get("rootpage")?,
                sql: row.try_get("sql")?,
            })
        })
        .collect()
}

pub async fn get_database_schema(State(state): State<AppState>) -> impl IntoResponse {
    let pool = state.db.read().await.clone();
    let Some(pool) = pool else {
        return (StatusCode::BAD_REQUEST, "No database connected").into_response();
    };

    match load_schema_objects(&pool).await {
        Ok(objects) => {
            let ddl = combined_ddl(&objects);
            Json(DatabaseSchema { objects, ddl }).into_response()
        }
        Err(error) => {
            tracing::error!("Failed to fetch database schema: {}", error);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch database schema",
            )
                .into_response()
        }
    }
}

pub async fn get_table_schema(
    State(state): State<AppState>,
    Query(query): Query<TableSchemaQuery>,
) -> impl IntoResponse {
    let pool = state.db.read().await.clone();
    let Some(pool) = pool else {
        return (StatusCode::BAD_REQUEST, "No database connected").into_response();
    };

    match load_table_schema(&pool, &query.name).await {
        Ok(Some(schema)) => Json(schema).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, "Table not found").into_response(),
        Err(error) => {
            tracing::error!("Failed to fetch table schema: {}", error);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch table schema",
            )
                .into_response()
        }
    }
}

pub async fn get_sqlite_internals(State(state): State<AppState>) -> impl IntoResponse {
    let pool = state.db.read().await.clone();
    let Some(pool) = pool else {
        return (StatusCode::BAD_REQUEST, "No database connected").into_response();
    };

    let result = async {
        let mut connection = pool.acquire().await?;
        let database = read_pragma_group(
            &mut connection,
            &[
                "database_list",
                "page_size",
                "page_count",
                "freelist_count",
                "journal_mode",
                "encoding",
                "user_version",
                "schema_version",
                "application_id",
                "auto_vacuum",
            ],
        )
        .await?;
        let connection_values = read_pragma_group(
            &mut connection,
            &["foreign_keys", "busy_timeout", "synchronous", "cache_size"],
        )
        .await?;
        let sqlite_version: String = sqlx::query_scalar("SELECT sqlite_version()")
            .fetch_one(&mut *connection)
            .await?;
        let mut engine = vec![MetadataValue {
            name: "sqlite_version".to_string(),
            values: vec![sqlite_version],
        }];
        engine.extend(read_pragma_group(&mut connection, &["compile_options"]).await?);
        let schema_entries = load_schema_entries(&mut connection).await?;
        Ok::<_, sqlx::Error>(SqliteInternals {
            database,
            connection: connection_values,
            engine,
            schema_entries,
        })
    }
    .await;

    match result {
        Ok(internals) => Json(internals).into_response(),
        Err(error) => {
            tracing::error!("Failed to fetch SQLite internals: {}", error);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch SQLite internals",
            )
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combined_ddl_adds_only_missing_statement_delimiters() {
        let objects = vec![
            SchemaObject {
                object_type: "table".to_string(),
                name: "users".to_string(),
                table_name: "users".to_string(),
                sql: Some("CREATE TABLE users(id INTEGER PRIMARY KEY)".to_string()),
            },
            SchemaObject {
                object_type: "view".to_string(),
                name: "user_ids".to_string(),
                table_name: "user_ids".to_string(),
                sql: Some("CREATE VIEW user_ids AS SELECT id FROM users;".to_string()),
            },
        ];

        assert_eq!(
            combined_ddl(&objects),
            "CREATE TABLE users(id INTEGER PRIMARY KEY);\n\nCREATE VIEW user_ids AS SELECT id FROM users;"
        );
    }

    async fn connected_state() -> AppState {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let statements = [
            "CREATE TABLE parent (id INTEGER PRIMARY KEY, code TEXT UNIQUE)",
            "CREATE TABLE \"order\"\"details\" (\
             id INTEGER PRIMARY KEY, \
             parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE, \
             label TEXT DEFAULT 'untitled', \
             label_upper TEXT GENERATED ALWAYS AS (upper(label)) VIRTUAL)",
            "CREATE INDEX order_label_idx ON \"order\"\"details\" \
             (label COLLATE NOCASE DESC) WHERE label IS NOT NULL",
            "CREATE TRIGGER order_label_trigger AFTER INSERT ON \"order\"\"details\" BEGIN \
             UPDATE parent SET code = NEW.label WHERE id = NEW.parent_id; END",
            "CREATE VIEW order_labels AS SELECT label FROM \"order\"\"details\"",
        ];
        for statement in statements {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        AppState::for_test(pool)
    }

    async fn response_json(response: axum::response::Response) -> serde_json::Value {
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    #[tokio::test]
    async fn database_schema_endpoint_returns_user_objects_and_combined_ddl() {
        let response = get_database_schema(State(connected_state().await))
            .await
            .into_response();
        let body = response_json(response).await;
        let objects = body["objects"].as_array().unwrap();
        let names: Vec<_> = objects
            .iter()
            .map(|object| object["name"].as_str().unwrap())
            .collect();

        assert_eq!(
            names,
            [
                "order\"details",
                "parent",
                "order_labels",
                "order_label_idx",
                "order_label_trigger"
            ]
        );
        let ddl = body["ddl"].as_str().unwrap();
        assert!(ddl.contains("CREATE TABLE \"order\"\"details\""));
        assert!(ddl.contains("CREATE VIEW order_labels"));
        assert!(ddl.contains("CREATE INDEX order_label_idx"));
        assert!(ddl.contains("CREATE TRIGGER order_label_trigger"));
        assert!(!ddl.contains("sqlite_autoindex"));
    }

    #[tokio::test]
    async fn table_schema_endpoint_returns_details_for_quoted_table_name() {
        let state = connected_state().await;
        let response = get_table_schema(
            State(state.clone()),
            Query(TableSchemaQuery {
                name: "order\"details".to_string(),
            }),
        )
        .await
        .into_response();
        let body = response_json(response).await;

        assert_eq!(body["name"], "order\"details");
        let columns = body["columns"].as_array().unwrap();
        assert_eq!(columns.len(), 4);
        assert_eq!(columns[1]["not_null"], true);
        assert_eq!(columns[2]["default_value"], "'untitled'");
        assert_eq!(columns[3]["hidden"], 2);
        assert_eq!(body["foreign_keys"][0]["referenced_table"], "parent");
        assert_eq!(body["foreign_keys"][0]["on_delete"], "CASCADE");
        assert_eq!(body["indexes"][0]["name"], "order_label_idx");
        assert_eq!(body["indexes"][0]["partial"], true);
        assert_eq!(body["indexes"][0]["columns"][0]["descending"], true);
        assert_eq!(body["indexes"][0]["columns"][0]["collation"], "NOCASE");
        assert_eq!(body["triggers"][0]["name"], "order_label_trigger");
        assert!(
            body["sql"]
                .as_str()
                .unwrap()
                .starts_with("CREATE TABLE \"order\"\"details\"")
        );

        let missing = get_table_schema(
            State(state),
            Query(TableSchemaQuery {
                name: "missing".to_string(),
            }),
        )
        .await
        .into_response();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn internals_endpoint_returns_pragmas_engine_and_internal_objects() {
        let response = get_sqlite_internals(State(connected_state().await))
            .await
            .into_response();
        let body = response_json(response).await;
        let database_names: Vec<_> = body["database"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["name"].as_str().unwrap())
            .collect();

        assert!(database_names.contains(&"database_list"));
        assert!(database_names.contains(&"page_size"));
        assert!(database_names.contains(&"journal_mode"));
        assert_eq!(body["engine"][0]["name"], "sqlite_version");
        assert!(
            body["engine"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["name"] == "compile_options")
        );
        assert!(
            body["schema_entries"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["name"]
                    .as_str()
                    .unwrap()
                    .starts_with("sqlite_autoindex_parent"))
        );
    }
}
