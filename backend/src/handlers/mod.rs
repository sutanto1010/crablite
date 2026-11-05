pub mod ai;
pub mod auth;
pub mod connection;
pub mod health;
pub mod metadata;
pub mod open_tabs;
pub mod query;
pub mod saved_queries;

pub use ai::correct_sql;
pub use auth::{get_auth_config, login, logout, verify_session_cookie};
pub use connection::{connect_db, delete_db_file, list_dbs, list_tables, rename_db_file, replace_db_file};
pub use health::health_check;
pub use metadata::{get_database_schema, get_sqlite_internals, get_table_schema};
pub use open_tabs::{get_open_tabs, init_open_tabs_db, put_open_tabs};
pub use query::execute_query;
pub use saved_queries::{
    create_saved_query, delete_saved_query, init_metadata_db, list_saved_queries,
    list_saved_query_tags, update_saved_query,
};
