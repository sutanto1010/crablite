# Crablite

Shared domain language for Crablite's SQLite management experience.

## Language

**Schema Explorer**:
A read-only inspection experience encompassing Table Schema, Database Schema, and SQLite Internals.
_Avoid_: Schema editor

**Table Schema**:
The complete structural definition of one table, including its columns, constraints, indexes, triggers, and defining SQL.
_Avoid_: Table data, row preview

**Database Schema**:
The collection of user-defined tables, views, indexes, and triggers in the connected database, together with their defining SQL.
_Avoid_: Database contents, SQLite Internals

**SQLite Internals**:
Read-only SQLite metadata, settings, engine information, and SQLite-maintained schema objects associated with the connected database.
_Avoid_: Database Schema, user schema

**User-Defined Object**:
A table, view, index, or trigger created for the application rather than maintained by SQLite for its own operation.
_Avoid_: Internal object

**Saved Query**:
A named, reusable SQL text scoped to one database file (`db_path`), with optional tags. Navigation-only: loading opens it in the editor, never auto-runs.
_Avoid_: Global query, shared query, snippet (unscoped)

**Saved Query Tag**:
One flat, lowercase label in a Saved Query's comma-separated tag list. Tags are normalized on write (trimmed, lowercased, sorted, deduped) and filtered with single-select exact match.
_Avoid_: Folder, category, hierarchy, keyword search

**Saved Queries Library**:
The per-database collection of Saved Queries shown on the Saved Queries page, filtered by name/SQL search and one tag, sorted by recency or name.
_Avoid_: Cross-database library
