import { Component, For, Show } from "solid-js";
import SqlEditor from "../components/SqlEditor";
import DataGrid from "../components/DataGrid";
import {
  tabs,
  activeTabId,
  setActiveTabId,
  addTab,
  closeTab,
  updateActiveTab,
  activeTab,
  runQuery,
  correctSql,
  isQuerying,
  isCorrecting,
  setIsSaveModalOpen,
  currentTable,
  queryHistory,
  tables,
  openTablePreview,
} from "../lib/store";
import Icon from "../components/Icon";

const QueryPage: Component = () => {
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
      <div class="flex items-center gap-2 overflow-x-auto" role="tablist" aria-label="Query tabs">
        <For each={tabs()}>
          {(tab) => (
            <div role="tab" aria-selected={tab.id === activeTabId()} class={`tab-btn shrink-0 rounded-t-md ${tab.id === activeTabId() ? "bg-card" : ""}`} data-active={tab.id === activeTabId()}>
              <button type="button" class="flex items-center gap-1.5" onClick={() => setActiveTabId(tab.id)} title={tab.sql || tab.name}>
                <Icon name="terminal" class="size-3.5" />
                <span class="max-w-32 truncate">{tab.name}</span>
              </button>
              <button
                type="button"
                class="rounded p-0.5 hover:bg-accent"
                onClick={() => closeTab(tab.id)}
                aria-label={`Close ${tab.name}`}
                disabled={tabs().length === 1}
                title="Close tab"
              >
                <Icon name="close" class="size-3" />
              </button>
            </div>
          )}
        </For>
        <button type="button" class="btn btn-ghost btn-sm shrink-0" onClick={() => addTab()} aria-label="New query tab">
          <Icon name="add" class="size-4" /> Tab
        </button>
        <div class="ml-auto hidden items-center gap-2 lg:flex">
          <span class="text-xs text-muted-foreground">
            Table: <span class="font-mono text-foreground">{currentTable() ?? "—"}</span>
          </span>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn btn-default btn-sm" onClick={() => runQuery()} disabled={isQuerying() || !activeTab().sql.trim()}>
          <Icon name="play_arrow" filled class="size-4" />
          {isQuerying() ? "Running…" : "Run"}
          <span class="kbd ml-1 hidden sm:inline-flex">Ctrl+↵</span>
        </button>
        <button type="button" class="btn btn-outline btn-sm" onClick={() => correctSql()} disabled={isCorrecting() || !activeTab().sql.trim()} title="Fix SQL with AI">
          <Icon name="smart_toy" class="size-4" />
          {isCorrecting() ? "Fixing…" : "AI Fix"}
        </button>
        <button type="button" class="btn btn-outline btn-sm" onClick={() => setIsSaveModalOpen(true)} disabled={!activeTab().sql.trim()}>
          <Icon name="save" class="size-4" />
          Save
          <span class="kbd ml-1 hidden sm:inline-flex">Ctrl+S</span>
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={() => {
            const name = window.prompt("Rename tab", activeTab().name);
            if (name?.trim()) updateActiveTab({ name: name.trim() });
          }}
          title="Rename tab"
        >
          <Icon name="edit" class="size-4" />
          Rename
        </button>
      </div>

      <SqlEditor value={activeTab().sql} onChange={(sql) => updateActiveTab({ sql })} onRun={() => runQuery()} onSave={() => setIsSaveModalOpen(true)} tables={tables()} />

      <DataGrid />

      <Show when={queryHistory().length > 0}>
        <details class="card p-3">
          <summary class="flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Icon name="history" class="size-4" />
            History ({queryHistory().length})
          </summary>
          <ul class="mt-2 max-h-32 space-y-1 overflow-y-auto">
            <For each={queryHistory().slice(0, 10)}>
              {(entry) => (
                <li>
                  <button
                    type="button"
                    class="sidebar-item font-mono text-xs"
                    onClick={() => {
                      updateActiveTab({ sql: entry.sql, page: 1 });
                      runQuery(entry.sql, 1);
                    }}
                    title={entry.sql}
                  >
                    <span class="truncate">{entry.sql}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </details>
      </Show>

      <Show when={tables().length > 0}>
        <div class="flex flex-wrap items-center gap-1.5 text-xs">
          <span class="text-muted-foreground">Quick preview:</span>
          <For each={tables().slice(0, 8)}>
            {(t) => (
              <button type="button" class="badge badge-secondary hover:border-primary" onClick={() => openTablePreview(t)}>
                {t}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default QueryPage;
