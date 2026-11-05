import { Component, For, Show, createSignal, createMemo, onMount, onCleanup } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import Icon from "../components/Icon";
import {
  savedQueries,
  isLoadingSavedQueries,
  fetchSavedQueries,
  fetchSavedTags,
  savedSearch,
  setSavedSearch,
  savedTag,
  setSavedTag,
  savedSort,
  setSavedSort,
  allSavedTags,
  removeSavedQuery,
  saveQuery,
  duplicateSavedQuery,
  pushToast,
  updateActiveTab,
  addTab,
  currentDbPath,
} from "../lib/store";
import type { SavedQuerySort } from "../lib/api";

const SORT_OPTIONS: { value: SavedQuerySort; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "created", label: "Recently created" },
  { value: "name", label: "Name A–Z" },
];

const SavedPage: Component = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [editName, setEditName] = createSignal("");
  const [editTags, setEditTags] = createSignal("");
  const [editSql, setEditSql] = createSignal("");

  let debounceTimer: number | undefined;

  const syncUrl = () => {
    setParams({
      search: savedSearch() || undefined,
      tag: savedTag() || undefined,
      sort: savedSort() !== "updated" ? savedSort() : undefined,
    });
  };

  const applyFilters = (immediate = false) => {
    syncUrl();
    if (immediate) {
      void fetchSavedQueries();
      return;
    }
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => void fetchSavedQueries(), 300);
  };

  onMount(() => {
    if (typeof params.search === "string") setSavedSearch(params.search);
    if (typeof params.tag === "string") setSavedTag(params.tag);
    if (params.sort === "name" || params.sort === "created" || params.sort === "updated") {
      setSavedSort(params.sort);
    }
    void fetchSavedTags();
    void fetchSavedQueries();
  });

  onCleanup(() => {
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
  });

  const hasActiveFilters = createMemo(() => Boolean(savedSearch().trim() || savedTag()));

  const clearFilters = () => {
    setSavedSearch("");
    setSavedTag("");
    setSavedSort("updated");
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
    syncUrl();
    void fetchSavedQueries();
  };

  const openInEditor = (query: string) => {
    addTab(query);
    navigate("/");
  };

  const copySql = async (query: string) => {
    try {
      await navigator.clipboard.writeText(query);
      pushToast("success", "SQL copied to clipboard");
    } catch {
      pushToast("error", "Copy failed");
    }
  };

  const duplicate = async (id: number) => {
    try {
      const created = await duplicateSavedQuery(id);
      pushToast("success", `Duplicated as "${created.name}"`);
    } catch (e: any) {
      pushToast("error", e?.message || "Duplicate failed");
    }
  };

  const startEdit = (id: number, name: string, tags: string, query: string) => {
    setEditingId(id);
    setEditName(name);
    setEditTags(tags);
    setEditSql(query);
  };

  const commitEdit = async (id: number) => {
    if (!editName().trim()) {
      pushToast("error", "Name cannot be empty");
      return;
    }
    if (!editSql().trim()) {
      pushToast("error", "SQL cannot be empty");
      return;
    }
    try {
      await saveQuery(editName().trim(), editSql().trim(), editTags().trim(), id);
      setEditingId(null);
      pushToast("success", "Saved query updated");
    } catch (e: any) {
      pushToast("error", e?.message || "Update failed");
    }
  };

  const remove = async (id: number, name: string) => {
    if (!window.confirm(`Delete saved query "${name}"?`)) return;
    try {
      await removeSavedQuery(id);
      pushToast("success", "Deleted");
    } catch (e: any) {
      pushToast("error", e?.message || "Delete failed");
    }
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
      <div class="flex flex-wrap items-end gap-2">
        <div>
          <h1 class="text-lg font-semibold tracking-tight">Saved Queries</h1>
          <p class="text-sm text-muted-foreground">
            Library for <span class="font-mono text-foreground">{currentDbPath() || "no database"}</span>. Search and tag your reusable SQL.
          </p>
          <Show when={!isLoadingSavedQueries()}>
            <p class="mt-0.5 text-xs text-muted-foreground" role="status">
              {savedQueries().length === 1 ? "1 query" : `${savedQueries().length} queries`}
              <Show when={hasActiveFilters()}> matching filters</Show>
              {" · "}tags: {allSavedTags().length}
            </p>
          </Show>
        </div>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <input
            class="input h-9 w-48"
            placeholder="Search name or SQL…"
            value={savedSearch()}
            onInput={(e) => {
              setSavedSearch(e.currentTarget.value);
              applyFilters();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilters(true);
              if (e.key === "Escape") clearFilters();
            }}
            aria-label="Search saved queries"
          />
          <select
            class="select h-9 w-auto max-w-44"
            value={savedTag()}
            onChange={(e) => {
              setSavedTag(e.currentTarget.value);
              applyFilters(true);
            }}
            aria-label="Filter by tag"
          >
            <option value="">All tags</option>
            <For each={allSavedTags()}>{(tag) => <option value={tag}>{tag}</option>}</For>
          </select>
          <select
            class="select h-9 w-auto"
            value={savedSort()}
            onChange={(e) => {
              setSavedSort(e.currentTarget.value as SavedQuerySort);
              applyFilters(true);
            }}
            aria-label="Sort saved queries"
          >
            <For each={SORT_OPTIONS}>{(o) => <option value={o.value}>{o.label}</option>}</For>
          </select>
          <Show when={hasActiveFilters()}>
            <button type="button" class="btn btn-ghost btn-sm" onClick={clearFilters}>
              <Icon name="close" class="size-4" /> Clear
            </button>
          </Show>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-icon"
            onClick={() => {
              void fetchSavedQueries();
              void fetchSavedTags();
            }}
            title="Refresh"
            aria-label="Refresh saved queries"
          >
            <Icon name="refresh" class="size-4" />
          </button>
        </div>
      </div>

      <Show when={isLoadingSavedQueries()}>
        <div class="grid flex-1 place-items-center text-muted-foreground" role="status">
          <p>Loading saved queries…</p>
        </div>
      </Show>

      <Show when={!isLoadingSavedQueries() && savedQueries().length === 0 && !hasActiveFilters()}>
        <div class="grid flex-1 place-items-center rounded-md border border-dashed border-border p-8 text-center">
          <div>
            <Icon name="bookmark" class="mx-auto mb-2 size-8 text-muted-foreground" />
            <p class="text-sm font-medium">No saved queries yet</p>
            <p class="mt-1 text-xs text-muted-foreground">Run a query, then press Ctrl+S to save it with tags.</p>
          </div>
        </div>
      </Show>

      <Show when={!isLoadingSavedQueries() && savedQueries().length === 0 && hasActiveFilters()}>
        <div class="grid flex-1 place-items-center rounded-md border border-dashed border-border p-8 text-center">
          <div>
            <Icon name="search" class="mx-auto mb-2 size-8 text-muted-foreground" />
            <p class="text-sm font-medium">No matching queries</p>
            <p class="mt-1 text-xs text-muted-foreground">Try a different search or tag.</p>
            <button type="button" class="btn btn-outline btn-sm mt-3" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        </div>
      </Show>

      <Show when={!isLoadingSavedQueries() && savedQueries().length > 0}>
        <ul class="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto md:grid-cols-2 xl:grid-cols-3">
          <For each={savedQueries()}>
            {(item) => (
              <li class="card flex flex-col p-4">
                <div class="mb-2 flex items-start gap-2">
                  <div class="min-w-0 flex-1">
                    <Show when={editingId() === item.id} fallback={<h2 class="truncate text-sm font-semibold" title={item.name}>{item.name}</h2>}>
                      <input class="input h-8 w-full" value={editName()} onInput={(e) => setEditName(e.currentTarget.value)} aria-label="Saved query name" />
                    </Show>
                    <p class="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      updated {item.updated_at} · created {item.created_at}
                    </p>
                  </div>
                  <button type="button" class="btn btn-ghost btn-sm btn-icon shrink-0" onClick={() => openInEditor(item.query)} title="Open in new editor tab" aria-label={`Open ${item.name} in editor`}>
                    <Icon name="terminal" class="size-4" />
                  </button>
                  <button type="button" class="btn btn-ghost btn-sm btn-icon shrink-0" onClick={() => copySql(item.query)} title="Copy SQL" aria-label={`Copy ${item.name} SQL`}>
                    <Icon name="content_copy" class="size-4" />
                  </button>
                </div>
                <Show
                  when={editingId() === item.id}
                  fallback={
                    <pre class="mb-2 max-h-28 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2.5 font-mono text-xs text-muted-foreground">{item.query}</pre>
                  }
                >
                  <textarea
                    class="input input-mono mb-2 min-h-24 w-full flex-1 whitespace-pre-wrap font-mono text-xs"
                    value={editSql()}
                    onInput={(e) => setEditSql(e.currentTarget.value)}
                    aria-label="Edit SQL"
                    rows={4}
                  />
                </Show>
                <div class="mb-2 flex flex-wrap gap-1.5">
                  <For each={(editingId() === item.id ? editTags() : item.tags || "").split(",").map((t) => t.trim()).filter(Boolean)}>
                    {(tag) => <span class="badge badge-secondary font-mono text-[11px]">{tag}</span>}
                  </For>
                  <Show when={!(editingId() === item.id ? editTags() : item.tags)}>
                    <span class="text-xs text-muted-foreground">untagged</span>
                  </Show>
                </div>
                <Show when={editingId() === item.id}>
                  <input class="input input-mono mb-2 h-8 w-full" value={editTags()} onInput={(e) => setEditTags(e.currentTarget.value)} placeholder="tags, comma separated" aria-label="Edit tags" />
                </Show>
                <div class="mt-auto flex items-center gap-1.5">
                  <Show when={editingId() === item.id} fallback={
                    <>
                      <button type="button" class="btn btn-outline btn-sm" onClick={() => { updateActiveTab({ sql: item.query, page: 1 }); navigate("/"); }} title="Load into active tab (no auto-run)">
                        <Icon name="code" class="size-4" /> Load
                      </button>
                      <button type="button" class="btn btn-ghost btn-sm" onClick={() => startEdit(item.id, item.name, item.tags || "", item.query)}>
                        <Icon name="edit" class="size-4" /> Edit
                      </button>
                      <button type="button" class="btn btn-ghost btn-sm" onClick={() => duplicate(item.id)} title="Duplicate" aria-label={`Duplicate ${item.name}`}>
                        <Icon name="content_copy" class="size-4" />
                      </button>
                      <button type="button" class="btn btn-ghost btn-sm ml-auto text-destructive" onClick={() => remove(item.id, item.name)} aria-label={`Delete ${item.name}`}>
                        <Icon name="delete" class="size-4" />
                      </button>
                    </>
                  }>
                    <button type="button" class="btn btn-default btn-sm" onClick={() => commitEdit(item.id)}>Save</button>
                    <button type="button" class="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </Show>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
};

export default SavedPage;
