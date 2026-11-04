import { Component, For, Show, createSignal, onMount } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import Icon from "../components/Icon";
import {
  savedQueries,
  isLoadingSavedQueries,
  fetchSavedQueries,
  savedSearch,
  setSavedSearch,
  savedTag,
  setSavedTag,
  allSavedTags,
  removeSavedQuery,
  saveQuery,
  pushToast,
  updateActiveTab,
  addTab,
  currentDbPath,
} from "../lib/store";

const SavedPage: Component = () => {
  const [params, setParams] = useSearchParams();
  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [editName, setEditName] = createSignal("");
  const [editTags, setEditTags] = createSignal("");

  onMount(() => {
    if (typeof params.search === "string") setSavedSearch(params.search);
    if (typeof params.tag === "string") setSavedTag(params.tag);
    fetchSavedQueries();
  });

  const applyFilters = () => {
    setParams({ search: savedSearch() || undefined, tag: savedTag() || undefined });
    fetchSavedQueries();
  };

  const openInEditor = (query: string) => {
    addTab(query);
  };

  const startEdit = (id: number, name: string, tags: string) => {
    setEditingId(id);
    setEditName(name);
    setEditTags(tags);
  };

  const commitEdit = async (id: number, query: string) => {
    if (!editName().trim()) {
      pushToast("error", "Name cannot be empty");
      return;
    }
    try {
      await saveQuery(editName().trim(), query, editTags().trim(), id);
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
      <div class="flex flex-wrap items-center gap-2">
        <div>
          <h1 class="text-lg font-semibold tracking-tight">Saved Queries</h1>
          <p class="text-sm text-muted-foreground">
            Library for <span class="font-mono text-foreground">{currentDbPath() || "no database"}</span>. Search and tag your reusable SQL.
          </p>
        </div>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <input
            class="input h-9 w-48"
            placeholder="Search name or SQL…"
            value={savedSearch()}
            onInput={(e) => setSavedSearch(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            aria-label="Search saved queries"
          />
          <select class="select h-9 w-auto" value={savedTag()} onChange={(e) => { setSavedTag(e.currentTarget.value); applyFilters(); }} aria-label="Filter by tag">
            <option value="">All tags</option>
            <For each={allSavedTags()}>{(tag) => <option value={tag}>{tag}</option>}</For>
          </select>
          <button type="button" class="btn btn-default btn-sm" onClick={applyFilters}>
            <Icon name="search" class="size-4" /> Search
          </button>
          <button type="button" class="btn btn-ghost btn-sm btn-icon" onClick={() => fetchSavedQueries()} title="Refresh" aria-label="Refresh saved queries">
            <Icon name="refresh" class="size-4" />
          </button>
        </div>
      </div>

      <Show when={isLoadingSavedQueries()}>
        <div class="grid flex-1 place-items-center text-muted-foreground" role="status">
          <p>Loading saved queries…</p>
        </div>
      </Show>

      <Show when={!isLoadingSavedQueries() && savedQueries().length === 0}>
        <div class="grid flex-1 place-items-center rounded-md border border-dashed border-border p-8 text-center">
          <div>
            <Icon name="bookmark" class="mx-auto mb-2 size-8 text-muted-foreground" />
            <p class="text-sm font-medium">No saved queries yet</p>
            <p class="mt-1 text-xs text-muted-foreground">Run a query, then press Ctrl+S to save it with tags.</p>
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
                    <Show when={editingId() === item.id} fallback={<h2 class="truncate text-sm font-semibold">{item.name}</h2>}>
                      <input class="input h-8 w-full" value={editName()} onInput={(e) => setEditName(e.currentTarget.value)} aria-label="Saved query name" />
                    </Show>
                    <p class="mt-0.5 font-mono text-[11px] text-muted-foreground">updated {item.updated_at}</p>
                  </div>
                  <button type="button" class="btn btn-ghost btn-sm btn-icon shrink-0" onClick={() => openInEditor(item.query)} title="Open in editor" aria-label={`Open ${item.name} in editor`}>
                    <Icon name="terminal" class="size-4" />
                  </button>
                </div>
                <pre class="mb-2 max-h-28 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2.5 font-mono text-xs text-muted-foreground">{item.query}</pre>
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
                      <button type="button" class="btn btn-outline btn-sm" onClick={() => { updateActiveTab({ sql: item.query, page: 1 }); }}>
                        <Icon name="code" class="size-4" /> Load
                      </button>
                      <button type="button" class="btn btn-ghost btn-sm" onClick={() => startEdit(item.id, item.name, item.tags || "")}>
                        <Icon name="edit" class="size-4" /> Edit
                      </button>
                      <button type="button" class="btn btn-ghost btn-sm ml-auto text-destructive" onClick={() => remove(item.id, item.name)} aria-label={`Delete ${item.name}`}>
                        <Icon name="delete" class="size-4" />
                      </button>
                    </>
                  }>
                    <button type="button" class="btn btn-default btn-sm" onClick={() => commitEdit(item.id, item.query)}>Save</button>
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
