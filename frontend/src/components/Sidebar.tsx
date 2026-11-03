import { Component, For, createSignal, Show } from "solid-js";
import {
  setShouldFocusSqlInput, setSqlContent, tables, setCurrentTable, runQuery,
  currentTable, execSql, fetchTables, refreshMetadata, setWorkspaceView,
  openTableSchema, openDatabaseSchema, openSqliteInternals, workspaceView,
  savedQueries, activeSavedQueryId, loadSavedQuery, removeSavedQuery,
  updateSavedQueryName, setIsSaveModalOpen, sqlContent, SavedQuery,
} from "../lib/store";
import Icon from "./Icon";

const Sidebar: Component = () => {
  const [showDropDialog, setShowDropDialog] = createSignal(false);
  const [tableToDrop, setTableToDrop] = createSignal("");

  const [showDeleteQueryDialog, setShowDeleteQueryDialog] = createSignal(false);
  const [queryToDelete, setQueryToDelete] = createSignal<SavedQuery | null>(null);

  const [showRenameQueryDialog, setShowRenameQueryDialog] = createSignal(false);
  const [queryToRename, setQueryToRename] = createSignal<SavedQuery | null>(null);
  const [renameQueryName, setRenameQueryName] = createSignal("");

  const handleAddTable = () => {
    setWorkspaceView("query");
    setSqlContent(`CREATE TABLE table_name (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);`);
    setShouldFocusSqlInput(true);
  };

  const handleTableClick = async (table: string) => {
    setCurrentTable(table);
    setWorkspaceView("query");
    setSqlContent(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT 100`);
    await runQuery();
  };

  const handleDropClick = (table: string, e: Event) => {
    e.stopPropagation();
    setTableToDrop(table);
    setShowDropDialog(true);
  };

  const confirmDrop = async () => {
    const table = tableToDrop();
    if (table) {
      try {
        await execSql(`DROP TABLE "${table.replace(/"/g, '""')}"`);
        await fetchTables();
        await refreshMetadata();
      } catch (e) {
        console.error("Failed to drop table", e);
      }
    }
    setShowDropDialog(false);
  };

  const handleOpenDeleteQuery = (query: SavedQuery, e: Event) => {
    e.stopPropagation();
    setQueryToDelete(query);
    setShowDeleteQueryDialog(true);
  };

  const confirmDeleteQuery = async () => {
    const target = queryToDelete();
    if (target) {
      try {
        await removeSavedQuery(target.id);
      } catch (e) {
        console.error("Failed to delete saved query", e);
      }
    }
    setShowDeleteQueryDialog(false);
    setQueryToDelete(null);
  };

  const handleOpenRename = (query: SavedQuery, e: Event) => {
    e.stopPropagation();
    setQueryToRename(query);
    setRenameQueryName(query.name);
    setShowRenameQueryDialog(true);
  };

  const confirmRenameQuery = async () => {
    const target = queryToRename();
    const newName = renameQueryName().trim();
    if (target && newName) {
      try {
        await updateSavedQueryName(target.id, newName);
      } catch (e) {
        console.error("Failed to rename saved query", e);
      }
    }
    setShowRenameQueryDialog(false);
    setQueryToRename(null);
  };

  return (
    <>
      <div class="md:hidden flex flex-col gap-2" aria-label="Mobile navigation">
        <div class="flex items-center gap-2" aria-label="Table navigation">
          <select
            class="select select-bordered flex-1 min-w-0"
            aria-label="Browse table"
            value={currentTable() || ""}
            onChange={(event) => void handleTableClick(event.currentTarget.value)}
          >
            <option value="" disabled>Select a table</option>
            <For each={tables()}>{(table) => <option value={table}>{table}</option>}</For>
          </select>
          <button
            class="btn btn-ghost btn-square"
            title="View selected table schema"
            aria-label="View selected table schema"
            disabled={!currentTable()}
            onClick={() => void openTableSchema(currentTable()!)}
          >
            <Icon name="schema" />
          </button>
          <button class="btn btn-primary btn-square" title="Create Table" aria-label="Create Table" onClick={handleAddTable}>
            <Icon name="add" />
          </button>
          <button
            class="btn btn-ghost btn-square text-error"
            title="Drop selected table"
            aria-label="Drop selected table"
            disabled={!currentTable()}
            onClick={(event) => handleDropClick(currentTable()!, event)}
          >
            <Icon name="delete" />
          </button>
        </div>

        <Show when={savedQueries().length > 0}>
          <div class="flex items-center gap-2" aria-label="Saved query navigation">
            <select
              class="select select-bordered select-sm flex-1 min-w-0"
              aria-label="Load saved query"
              value={activeSavedQueryId() || ""}
              onChange={(event) => {
                const id = Number(event.currentTarget.value);
                const q = savedQueries().find((item) => item.id === id);
                if (q) loadSavedQuery(q);
              }}
            >
              <option value="" disabled selected={!activeSavedQueryId()}>
                Saved Queries ({savedQueries().length})
              </option>
              <For each={savedQueries()}>{(q) => <option value={q.id}>{q.name}</option>}</For>
            </select>
            <button
              class="btn btn-sm btn-outline"
              onClick={() => setIsSaveModalOpen(true)}
              disabled={!sqlContent().trim()}
              title="Save current query"
            >
              <Icon name="bookmark" class="size-4" /> Save
            </button>
          </div>
        </Show>
      </div>

      <aside class="w-60 lg:w-64 flex-shrink-0 bg-base-100 rounded-2xl border border-base-300 h-full overflow-hidden min-h-0 hidden md:flex md:flex-col">
        <nav class="p-3 border-b border-base-300 space-y-1 flex-shrink-0" aria-label="Database exploration">
          <button class={`sidebar-nav-item ${workspaceView() === "schema" ? "sidebar-nav-item-active" : ""}`} onClick={openDatabaseSchema}>
            <Icon name="account_tree" /> Database Schema
          </button>
          <button class={`sidebar-nav-item ${workspaceView() === "internals" ? "sidebar-nav-item-active" : ""}`} onClick={openSqliteInternals}>
            <Icon name="settings_ethernet" /> SQLite Internals
          </button>
        </nav>

        {/* Tables Section */}
        <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div class="flex items-center justify-between px-4 pt-3 flex-shrink-0">
            <h2 class="text-sm font-medium uppercase tracking-wider text-base-content/60">Tables</h2>
            <button class="btn btn-xs btn-primary btn-square" title="Create Table" aria-label="Create Table" onClick={handleAddTable}>
              <Icon name="add" class="size-4" />
            </button>
          </div>
          <div class="flex-1 overflow-y-auto px-2 py-1">
            {tables().length === 0 ? (
              <div class="text-base-content/55 text-sm px-2 my-2">No tables found</div>
            ) : (
              <ul class="w-full flex flex-col gap-1">
                <For each={tables()}>
                  {(table) => (
                    <li class={`group flex items-center rounded-xl ${currentTable() === table && workspaceView() === "query" ? "bg-primary/12" : "hover:bg-base-200"}`}>
                      <button class="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left text-sm" onClick={() => handleTableClick(table)} title={`Browse ${table}`}>
                        <Icon name="table" class={`size-4.5 ${currentTable() === table ? "text-primary" : "text-base-content/55"}`} />
                        <span class="truncate">{table}</span>
                      </button>
                      <button class="btn btn-xs btn-ghost btn-square" title={`View ${table} schema`} aria-label={`View ${table} schema`} onClick={() => openTableSchema(table)}>
                        <Icon name="schema" class="size-4" />
                      </button>
                      <button class="btn btn-xs btn-ghost btn-square text-error mr-1" title={`Drop ${table}`} aria-label={`Drop ${table}`} onClick={(e) => handleDropClick(table, e)}>
                        <Icon name="delete" class="size-4" />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            )}
          </div>
        </div>

        {/* Saved Queries Section */}
        <div class="border-t border-base-300 flex flex-col flex-1 min-h-0 overflow-hidden">
          <div class="flex items-center justify-between px-4 pt-3 flex-shrink-0">
            <h2 class="text-sm font-medium uppercase tracking-wider text-base-content/60">Saved Queries</h2>
            <button
              class="btn btn-xs btn-ghost btn-square"
              title="Save current query"
              aria-label="Save current query"
              onClick={() => setIsSaveModalOpen(true)}
              disabled={!sqlContent().trim()}
            >
              <Icon name="add" class="size-4" />
            </button>
          </div>
          <div class="flex-1 overflow-y-auto px-2 py-1">
            {savedQueries().length === 0 ? (
              <div class="text-base-content/55 text-sm px-2 my-2">No saved queries</div>
            ) : (
              <ul class="w-full flex flex-col gap-1">
                <For each={savedQueries()}>
                  {(query) => (
                    <li class={`group flex items-center rounded-xl ${activeSavedQueryId() === query.id && workspaceView() === "query" ? "bg-primary/12" : "hover:bg-base-200"}`}>
                      <button
                        class="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left text-sm"
                        onClick={() => loadSavedQuery(query)}
                        title={query.name}
                      >
                        <Icon name="bookmark" class={`size-4.5 ${activeSavedQueryId() === query.id ? "text-primary" : "text-base-content/55"}`} />
                        <span class="truncate">{query.name}</span>
                      </button>
                      <button
                        class="btn btn-xs btn-ghost btn-square opacity-0 group-hover:opacity-100 transition-opacity"
                        title={`Rename ${query.name}`}
                        aria-label={`Rename ${query.name}`}
                        onClick={(e) => handleOpenRename(query, e)}
                      >
                        <Icon name="edit" class="size-4" />
                      </button>
                      <button
                        class="btn btn-xs btn-ghost btn-square text-error mr-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        title={`Delete ${query.name}`}
                        aria-label={`Delete ${query.name}`}
                        onClick={(e) => handleOpenDeleteQuery(query, e)}
                      >
                        <Icon name="delete" class="size-4" />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            )}
          </div>
        </div>
      </aside>

      {/* Drop Table Confirmation */}
      <dialog class="modal" classList={{ "modal-open": showDropDialog() }}>
        <div class="modal-box">
          <div class="size-12 rounded-full bg-error/12 text-error grid place-items-center mb-4"><Icon name="delete" /></div>
          <h3 class="font-medium text-xl">Drop table?</h3>
          <p class="py-3 text-sm text-base-content/70">
            Are you sure you want to drop <span class="font-mono font-medium">{tableToDrop()}</span>? This action cannot be undone.
          </p>
          <div class="modal-action">
            <button class="btn btn-ghost" onClick={() => setShowDropDialog(false)}>Cancel</button>
            <button class="btn btn-error" onClick={confirmDrop}>Drop table</button>
          </div>
        </div>
      </dialog>

      {/* Delete Query Confirmation */}
      <dialog class="modal" classList={{ "modal-open": showDeleteQueryDialog() }}>
        <div class="modal-box">
          <div class="size-12 rounded-full bg-error/12 text-error grid place-items-center mb-4"><Icon name="delete" /></div>
          <h3 class="font-medium text-xl">Delete saved query?</h3>
          <p class="py-3 text-sm text-base-content/70">
            Are you sure you want to delete <span class="font-medium">"{queryToDelete()?.name}"</span>?
          </p>
          <div class="modal-action">
            <button class="btn btn-ghost" onClick={() => setShowDeleteQueryDialog(false)}>Cancel</button>
            <button class="btn btn-error" onClick={confirmDeleteQuery}>Delete</button>
          </div>
        </div>
      </dialog>

      {/* Rename Query Modal */}
      <dialog class="modal" classList={{ "modal-open": showRenameQueryDialog() }}>
        <div class="modal-box max-w-sm">
          <h3 class="font-medium text-lg mb-3">Rename Query</h3>
          <input
            type="text"
            class="input input-bordered w-full"
            value={renameQueryName()}
            onInput={(e) => setRenameQueryName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmRenameQuery();
            }}
            autofocus
          />
          <div class="modal-action">
            <button class="btn btn-ghost" onClick={() => setShowRenameQueryDialog(false)}>Cancel</button>
            <button class="btn btn-primary" onClick={confirmRenameQuery} disabled={!renameQueryName().trim()}>Save</button>
          </div>
        </div>
      </dialog>
    </>
  );
};

export default Sidebar;
