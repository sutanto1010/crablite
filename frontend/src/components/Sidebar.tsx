import { Component, For, createSignal } from "solid-js";
import {
  setShouldFocusSqlInput, setSqlContent, tables, setCurrentTable, runQuery,
  currentTable, execSql, fetchTables, refreshMetadata, setWorkspaceView,
  openTableSchema, openDatabaseSchema, openSqliteInternals, workspaceView,
} from "../lib/store";
import Icon from "./Icon";

const Sidebar: Component = () => {
  const [showDropDialog, setShowDropDialog] = createSignal(false);
  const [tableToDrop, setTableToDrop] = createSignal("");

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

  return (
    <>
      <div class="md:hidden flex items-center gap-2" aria-label="Table navigation">
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

      <aside class="w-60 lg:w-64 flex-shrink-0 bg-base-100 rounded-2xl border border-base-300 h-full overflow-y-auto min-h-0 hidden md:flex md:flex-col">
        <nav class="p-3 border-b border-base-300 space-y-1" aria-label="Database exploration">
          <button class={`sidebar-nav-item ${workspaceView() === "schema" ? "sidebar-nav-item-active" : ""}`} onClick={openDatabaseSchema}>
            <Icon name="account_tree" /> Database Schema
          </button>
          <button class={`sidebar-nav-item ${workspaceView() === "internals" ? "sidebar-nav-item-active" : ""}`} onClick={openSqliteInternals}>
            <Icon name="settings_ethernet" /> SQLite Internals
          </button>
        </nav>

        <div class="flex items-center justify-between px-4 pt-4">
          <h2 class="text-sm font-medium uppercase tracking-wider text-base-content/60">Tables</h2>
          <button class="btn btn-xs btn-primary btn-square" title="Create Table" aria-label="Create Table" onClick={handleAddTable}>
            <Icon name="add" class="size-4" />
          </button>
        </div>
        {tables().length === 0 ? (
          <div class="text-base-content/55 text-sm px-4 my-3">No tables found</div>
        ) : (
          <ul class="w-full flex flex-col gap-1 p-2 my-1">
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
      </aside>

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
    </>
  );
};

export default Sidebar;
