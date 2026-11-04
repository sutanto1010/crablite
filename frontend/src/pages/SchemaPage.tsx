import { Component, For, Show, createSignal, createMemo, onMount } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import Icon from "../components/Icon";
import {
  databaseSchema,
  isMetadataLoading,
  metadataError,
  loadSchema,
  refreshMetadata,
  selectSchemaObject,
  selectedSchemaObject,
  tableSchema,
  pushToast,
  currentTable,
  openTablePreview,
} from "../lib/store";
import type { SchemaObject } from "../lib/api";

const objectIcons: Record<SchemaObject["object_type"], string> = {
  table: "table",
  view: "visibility",
  index: "format_list_numbered",
  trigger: "bolt",
};

const SchemaPage: Component = () => {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = createSignal("");
  const [typeFilter, setTypeFilter] = createSignal<"all" | SchemaObject["object_type"]>("all");
  const [showDdl, setShowDdl] = createSignal(false);

  onMount(() => {
    loadSchema((params.object as string) || null);
  });

  const objects = createMemo(() => {
    const q = filter().trim().toLowerCase();
    return (databaseSchema()?.objects || []).filter((o) => {
      if (typeFilter() !== "all" && o.object_type !== typeFilter()) return false;
      return !q || o.name.toLowerCase().includes(q) || o.table_name.toLowerCase().includes(q);
    });
  });

  const selectedObject = () => databaseSchema()?.objects.find((o) => o.name === selectedSchemaObject());
  const schema = () => tableSchema();

  const relations = createMemo(() => {
    const s = schema();
    if (!s) return [];
    const out = s.foreign_keys.map((fk) => ({ from: `${s.name}.${fk.from}`, to: `${fk.referenced_table}.${fk.to ?? "?"}` }));
    // Reverse references: other tables pointing at this one.
    for (const obj of databaseSchema()?.objects || []) {
      void obj;
    }
    return out;
  });

  const pick = async (object: SchemaObject) => {
    setParams({ object: object.name });
    await selectSchemaObject(object);
  };

  const copyDdl = async () => {
    const ddl = showDdl() ? selectedObject()?.sql : databaseSchema()?.ddl;
    if (!ddl) return;
    try {
      await navigator.clipboard.writeText(ddl);
      pushToast("success", "DDL copied");
    } catch {
      pushToast("error", "Copy failed");
    }
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
      <div class="flex flex-wrap items-center gap-2">
        <div>
          <h1 class="text-lg font-semibold tracking-tight">{schema()?.name || "Database Schema"}</h1>
          <p class="text-sm text-muted-foreground">Tables, views, indexes, triggers, and foreign-key graph.</p>
        </div>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <input class="input h-9 w-52" placeholder="Filter objects…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} aria-label="Filter schema objects" />
          <select class="select h-9 w-auto" value={typeFilter()} onChange={(e) => setTypeFilter(e.currentTarget.value as any)} aria-label="Filter by object type">
            <option value="all">All types</option>
            <option value="table">Tables</option>
            <option value="view">Views</option>
            <option value="index">Indexes</option>
            <option value="trigger">Triggers</option>
          </select>
          <button type="button" class="btn btn-ghost btn-sm btn-icon" onClick={() => refreshMetadata("schema")} disabled={isMetadataLoading()} title="Refresh schema" aria-label="Refresh schema">
            <Icon name="refresh" class="size-4" />
          </button>
        </div>
      </div>

      <Show when={metadataError()}>
        <div role="alert" class="alert alert-error text-sm">
          <Icon name="error" class="size-4" />
          <span>{metadataError()}</span>
        </div>
      </Show>

      <Show when={isMetadataLoading()}>
        <div class="grid flex-1 place-items-center text-muted-foreground" role="status">
          <p>Reading SQLite metadata…</p>
        </div>
      </Show>

      <Show when={!isMetadataLoading()}>
        <div class="grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_1fr]">
          <aside class="card flex min-h-0 flex-col overflow-hidden" aria-label="Schema objects">
            <div class="flex items-center justify-between border-b border-border px-3 py-2">
              <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Objects</span>
              <span class="badge badge-secondary">{objects().length}</span>
            </div>
            <ul class="min-h-0 flex-1 overflow-y-auto p-1.5" role="list">
              <For each={objects()}>
                {(object) => (
                  <li>
                    <button type="button" class="sidebar-item font-mono text-[13px]" data-active={selectedSchemaObject() === object.name} onClick={() => pick(object)} title={object.sql || object.name}>
                      <Icon name={objectIcons[object.object_type]} class="size-4 shrink-0" />
                      <span class="truncate">{object.name}</span>
                      <span class="ml-auto text-[10px] uppercase tracking-wide opacity-60">{object.object_type}</span>
                    </button>
                  </li>
                )}
              </For>
              <Show when={objects().length === 0}>
                <li class="p-4 text-center text-sm text-muted-foreground">No objects match.</li>
              </Show>
            </ul>
          </aside>

          <div class="flex min-h-0 flex-col gap-3 overflow-y-auto">
            <Show when={schema()} fallback={
              <div class="card p-4">
                <Show when={selectedObject()} fallback={<p class="text-sm text-muted-foreground">Select an object to inspect it.</p>}>
                  <div class="mb-2 flex items-center gap-2">
                    <Icon name={objectIcons[selectedObject()!.object_type]} class="size-4" />
                    <h2 class="font-mono text-sm font-semibold">{selectedObject()!.name}</h2>
                    <span class="badge badge-secondary">{selectedObject()!.object_type}</span>
                    <Show when={selectedObject()!.object_type === "view" || selectedObject()!.object_type === "table"}>
                      <button type="button" class="btn btn-outline btn-sm ml-auto" onClick={() => openTablePreview(selectedObject()!.name)}>
                        Preview rows
                      </button>
                    </Show>
                  </div>
                  <Show when={selectedObject()!.sql}>
                    <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">{selectedObject()!.sql}</pre>
                  </Show>
                </Show>
              </div>
            }>
              <div class="card p-4">
                <div class="mb-3 flex flex-wrap items-center gap-2">
                  <Icon name="table" class="size-5 text-primary" />
                  <h2 class="font-mono text-base font-semibold">{schema()!.name}</h2>
                  <span class="badge badge-secondary">{schema()!.columns.length} columns</span>
                  <span class="badge badge-secondary">{schema()!.foreign_keys.length} FK</span>
                  <div class="ml-auto flex gap-1.5">
                    <button type="button" class="btn btn-ghost btn-sm" onClick={() => setShowDdl(!showDdl())}>
                      {showDdl() ? "Hide DDL" : "Show DDL"}
                    </button>
                    <button type="button" class="btn btn-outline btn-sm" onClick={copyDdl}>
                      <Icon name="content_copy" class="size-4" /> Copy DDL
                    </button>
                    <button type="button" class="btn btn-default btn-sm" onClick={() => openTablePreview(schema()!.name)}>
                      <Icon name="play_arrow" class="size-4" /> Preview
                    </button>
                  </div>
                </div>
                <Show when={showDdl() && schema()!.sql}>
                  <pre class="mb-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">{schema()!.sql}</pre>
                </Show>
                <div class="overflow-x-auto rounded-md border border-border">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Column</th>
                        <th scope="col">Type</th>
                        <th scope="col">Null</th>
                        <th scope="col">Default</th>
                        <th scope="col">PK</th>
                        <th scope="col">Hidden</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={schema()!.columns}>
                        {(col) => (
                          <tr>
                            <td class="font-mono font-medium">{col.name}</td>
                            <td class="font-mono">{col.declared_type || "—"}</td>
                            <td>{col.not_null ? "NO" : "YES"}</td>
                            <td class="font-mono">{col.default_value ?? "—"}</td>
                            <td>{col.primary_key_position || "—"}</td>
                            <td>{col.hidden ? `hidden(${col.hidden})` : "—"}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>

              <div class="grid gap-3 md:grid-cols-2">
                <div class="card p-4">
                  <h3 class="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <Icon name="account_tree" class="size-4" /> Foreign keys & relations
                  </h3>
                  <Show when={relations().length > 0} fallback={<p class="text-sm text-muted-foreground">No foreign keys from this table.</p>}>
                    <ul class="space-y-2">
                      <For each={relations()}>
                        {(rel) => (
                          <li class="rounded-md bg-muted p-2 font-mono text-xs">
                            <span class="text-primary">{rel.from}</span>
                            <span class="mx-2 text-muted-foreground">→</span>
                            <span>{rel.to}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                  <Show when={(databaseSchema()?.objects || []).some((o) => o.object_type === "table")}>
                    <div class="mt-3 border-t border-border pt-3">
                      <p class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Simple ER (FK edges)</p>
                      <ul class="space-y-1 font-mono text-xs">
                        <For each={(schema()?.foreign_keys || []).map((fk) => `${schema()!.name} ── ${fk.from} ─▶ ${fk.referenced_table}.${fk.to ?? "?"}`)}>
                          {(edge) => <li class="truncate" title={edge}>{edge}</li>}
                        </For>
                      </ul>
                    </div>
                  </Show>
                </div>
                <div class="card p-4">
                  <h3 class="mb-2 text-sm font-semibold">Indexes ({schema()!.indexes.length})</h3>
                  <Show when={schema()!.indexes.length > 0} fallback={<p class="text-sm text-muted-foreground">No indexes.</p>}>
                    <ul class="space-y-2">
                      <For each={schema()!.indexes}>
                        {(idx) => (
                          <li class="rounded-md bg-muted p-2 text-xs">
                            <div class="flex items-center gap-2 font-mono font-medium">
                              {idx.name}
                              {idx.unique && <span class="badge badge-primary">unique</span>}
                              {idx.partial && <span class="badge badge-secondary">partial</span>}
                            </div>
                            <div class="mt-1 font-mono text-muted-foreground">{idx.columns.map((c) => `${c.name ?? "?"}${c.descending ? " DESC" : ""}`).join(", ")}</div>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                  <h3 class="mb-2 mt-4 text-sm font-semibold">Triggers ({schema()!.triggers.length})</h3>
                  <Show when={schema()!.triggers.length > 0} fallback={<p class="text-sm text-muted-foreground">No triggers.</p>}>
                    <ul class="space-y-2">
                      <For each={schema()!.triggers}>
                        {(t) => (
                          <li>
                            <details class="rounded-md bg-muted">
                              <summary class="cursor-pointer p-2 font-mono text-xs font-medium">{t.name}</summary>
                              <pre class="max-h-40 overflow-auto whitespace-pre-wrap break-all p-2 pt-0 font-mono text-xs text-muted-foreground">{t.sql}</pre>
                            </details>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </div>
              </div>
            </Show>
            <Show when={currentTable()}>
              <p class="text-xs text-muted-foreground">Current table context: <span class="font-mono text-foreground">{currentTable()}</span></p>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default SchemaPage;
