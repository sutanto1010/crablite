import { Component, For, Show, createSignal } from "solid-js";
import Icon from "./Icon";
import {
  databaseSchema,
  isMetadataLoading,
  metadataError,
  openDatabaseSchema,
  refreshMetadata,
  selectSchemaObject,
  selectedSchemaObject,
  sqliteInternals,
  tableSchema,
  workspaceView,
} from "../lib/store";
import type { MetadataValue, SchemaObject } from "../lib/api";

const objectIcons: Record<SchemaObject["object_type"], string> = {
  table: "table",
  view: "visibility",
  index: "format_list_numbered",
  trigger: "bolt",
};

const SchemaExplorer: Component = () => {
  const [showDdl, setShowDdl] = createSignal(false);
  const [internalOnly, setInternalOnly] = createSignal(true);
  const [copyStatus, setCopyStatus] = createSignal("");

  const selectedObject = () => databaseSchema()?.objects.find((object) => object.name === selectedSchemaObject());
  const schemaEntries = () => sqliteInternals()?.schema_entries.filter((entry) =>
    !internalOnly() || entry.name.startsWith("sqlite_"),
  ) || [];

  const copyDdl = async () => {
    const ddl = databaseSchema()?.ddl;
    if (!ddl) return;
    try {
      await navigator.clipboard.writeText(ddl);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed");
    }
    setTimeout(() => setCopyStatus(""), 1800);
  };

  const hiddenLabel = (hidden: number) => {
    if (hidden === 2) return "Virtual generated";
    if (hidden === 3) return "Stored generated";
    if (hidden === 1) return "Hidden";
    return "—";
  };

  return (
    <section class="flex-1 min-h-0 flex flex-col" aria-label="Schema Explorer">
      <div class="flex flex-wrap items-start justify-between gap-3 pb-3">
        <div>
          <h2 class="text-lg font-medium tracking-tight">
            {workspaceView() === "internals" ? "SQLite Internals" : tableSchema()?.name || "Database Schema"}
          </h2>
          <p class="text-sm text-base-content/65 mt-0.5">
            {workspaceView() === "internals"
              ? "Read-only database, connection, and engine metadata for main"
              : "User-defined structure in the main database"}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Show when={workspaceView() === "schema" && databaseSchema()?.ddl}>
            <button class="btn btn-sm btn-outline" onClick={copyDdl} title="Copy combined database DDL">
              <Icon name={copyStatus() === "Copied" ? "check" : "content_copy"} />
              {copyStatus() || "Copy SQL"}
            </button>
          </Show>
          <button
            class="btn btn-sm btn-ghost btn-square"
            onClick={refreshMetadata}
            disabled={isMetadataLoading()}
            title="Refresh metadata"
            aria-label="Refresh metadata"
          >
            <Icon name="refresh" />
          </button>
        </div>
      </div>

      <Show when={metadataError()}>
        <div role="alert" class="alert alert-error mb-3">
          <Icon name="error" />
          <span>{metadataError()}</span>
        </div>
      </Show>

      <Show when={isMetadataLoading()}>
        <div class="flex-1 grid place-items-center text-base-content/65" role="status">
          <span class="loading loading-spinner loading-md text-primary" />
          <span class="ml-3">Reading SQLite metadata…</span>
        </div>
      </Show>

      <Show when={!isMetadataLoading() && workspaceView() === "schema"}>
        <div class="flex-1 min-h-0 flex flex-col lg:flex-row rounded-2xl border border-base-300 overflow-hidden">
          <aside class="lg:w-64 flex-shrink-0 bg-base-200/60 border-b lg:border-b-0 lg:border-r border-base-300 overflow-auto max-h-52 lg:max-h-none">
            <div class="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-base-200/95 border-b border-base-300">
              <span class="text-xs font-medium uppercase tracking-wider text-base-content/60">Objects</span>
              <span class="badge badge-sm">{databaseSchema()?.objects.length || 0}</span>
            </div>
            <Show when={databaseSchema()?.objects.length} fallback={
              <div class="p-5 text-sm text-base-content/60">No user-defined objects</div>
            }>
              <ul class="p-2 space-y-1">
                <For each={databaseSchema()?.objects}>
                  {(object) => (
                    <li>
                      <button
                        class={`w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-base-300 ${selectedSchemaObject() === object.name ? "bg-primary/12 text-primary" : ""}`}
                        onClick={() => selectSchemaObject(object)}
                      >
                        <Icon name={objectIcons[object.object_type]} class="size-4.5" />
                        <span class="truncate flex-1">{object.name}</span>
                        <span class="text-[10px] uppercase tracking-wide text-base-content/50">{object.object_type}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </aside>

          <div class="flex-1 min-w-0 overflow-auto">
            <Show when={tableSchema()}>
              {(schema) => (
                <div class="p-4 sm:p-5 space-y-5">
                  <section>
                    <div class="flex items-center gap-2 mb-3">
                      <Icon name="table" class="size-5 text-primary" />
                      <h3 class="font-medium">Columns</h3>
                      <span class="badge badge-sm">{schema().columns.length}</span>
                    </div>
                    <div class="overflow-x-auto border border-base-300 rounded-xl">
                      <table class="table table-sm">
                        <thead><tr><th>Name</th><th>Declared type</th><th>Constraints</th><th>Default</th><th>Visibility</th></tr></thead>
                        <tbody>
                          <For each={schema().columns}>
                            {(column) => (
                              <tr>
                                <td class="font-mono font-medium">{column.name}</td>
                                <td class="font-mono">{column.declared_type || "—"}</td>
                                <td>
                                  <div class="flex flex-wrap gap-1">
                                    <Show when={column.primary_key_position > 0}><span class="badge badge-xs badge-primary">PK {column.primary_key_position}</span></Show>
                                    <Show when={column.not_null}><span class="badge badge-xs">NOT NULL</span></Show>
                                    <Show when={column.primary_key_position === 0 && !column.not_null}>—</Show>
                                  </div>
                                </td>
                                <td class="font-mono">{column.default_value ?? "—"}</td>
                                <td class="text-xs">{hiddenLabel(column.hidden)}</td>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <Show when={schema().foreign_keys.length > 0}>
                    <section>
                      <h3 class="font-medium mb-3">Foreign keys</h3>
                      <div class="overflow-x-auto border border-base-300 rounded-xl">
                        <table class="table table-sm">
                          <thead><tr><th>Column</th><th>References</th><th>On update</th><th>On delete</th><th>Match</th></tr></thead>
                          <tbody><For each={schema().foreign_keys}>{(key) => <tr>
                            <td class="font-mono">{key.from}</td>
                            <td class="font-mono">{key.referenced_table}({key.to ?? "primary key"})</td>
                            <td>{key.on_update}</td><td>{key.on_delete}</td><td>{key.match_type}</td>
                          </tr>}</For></tbody>
                        </table>
                      </div>
                    </section>
                  </Show>

                  <Show when={schema().indexes.length > 0}>
                    <section>
                      <h3 class="font-medium mb-3">Indexes</h3>
                      <div class="space-y-2">
                        <For each={schema().indexes}>{(index) => (
                          <div class="rounded-xl border border-base-300 p-3">
                            <div class="flex flex-wrap items-center gap-2">
                              <span class="font-mono text-sm font-medium">{index.name}</span>
                              <Show when={index.unique}><span class="badge badge-xs badge-primary">UNIQUE</span></Show>
                              <span class="badge badge-xs">{index.origin}</span>
                              <Show when={index.partial}><span class="badge badge-xs">PARTIAL</span></Show>
                            </div>
                            <div class="text-xs font-mono text-base-content/65 mt-1.5">
                              <For each={index.columns}>{(column, i) => <span>{i() > 0 ? ", " : ""}{column.name ?? "rowid"}{column.descending ? " DESC" : ""} ({column.collation})</span>}</For>
                            </div>
                          </div>
                        )}</For>
                      </div>
                    </section>
                  </Show>

                  <Show when={schema().triggers.length > 0}>
                    <section>
                      <h3 class="font-medium mb-3">Triggers</h3>
                      <For each={schema().triggers}>{(trigger) => (
                        <details class="schema-disclosure mb-2">
                          <summary class="font-mono text-sm">{trigger.name}</summary>
                          <pre class="schema-sql">{trigger.sql || "SQL not available"}</pre>
                        </details>
                      )}</For>
                    </section>
                  </Show>

                  <details class="schema-disclosure" open>
                    <summary>CREATE TABLE SQL</summary>
                    <pre class="schema-sql">{schema().sql || "SQL not available"}</pre>
                  </details>
                </div>
              )}
            </Show>

            <Show when={!tableSchema() && selectedObject()}>
              {(object) => (
                <div class="p-5">
                  <div class="flex items-center gap-2 mb-1">
                    <Icon name={objectIcons[object().object_type]} class="text-primary" />
                    <h3 class="font-medium font-mono">{object().name}</h3>
                    <span class="badge badge-sm">{object().object_type}</span>
                  </div>
                  <p class="text-sm text-base-content/60 mb-4">Related table: {object().table_name}</p>
                  <pre class="schema-sql">{object().sql || "This object has no stored SQL definition."}</pre>
                </div>
              )}
            </Show>

            <Show when={!tableSchema() && !selectedObject()}>
              <div class="h-full min-h-64 flex flex-col items-center justify-center p-6 text-center">
                <Icon name="account_tree" class="size-10 text-base-content/30" />
                <h3 class="font-medium mt-3">Explore the database structure</h3>
                <p class="text-sm text-base-content/60 mt-1 max-w-sm">Select an object to inspect its definition, or review the combined DDL.</p>
                <Show when={databaseSchema()?.ddl}>
                  <button class="btn btn-sm btn-outline mt-4" onClick={() => setShowDdl(!showDdl())}>
                    <Icon name="code" /> {showDdl() ? "Hide" : "View"} combined DDL
                  </button>
                  <Show when={showDdl()}><pre class="schema-sql mt-4 text-left w-full max-w-3xl">{databaseSchema()?.ddl}</pre></Show>
                </Show>
                <Show when={!databaseSchema() && !metadataError()}>
                  <button class="btn btn-primary mt-4" onClick={openDatabaseSchema}>Load schema</button>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={!isMetadataLoading() && workspaceView() === "internals" && sqliteInternals()}>
        <div class="flex-1 min-h-0 overflow-auto space-y-4 pr-1">
          <div class="grid xl:grid-cols-3 md:grid-cols-2 gap-3">
            <For each={[
              { title: "Database", icon: "database", values: sqliteInternals()?.database },
              { title: "Connection", icon: "cable", values: sqliteInternals()?.connection },
              { title: "Engine", icon: "memory", values: sqliteInternals()?.engine },
            ]}>
              {(group) => (
                <section class="rounded-2xl border border-base-300 bg-base-100 p-4">
                  <div class="flex items-center gap-2 mb-3"><Icon name={group.icon} class="text-primary" /><h3 class="font-medium">{group.title}</h3></div>
                  <dl class="space-y-2.5">
                    <For each={group.values}>{(item: MetadataValue) => (
                      <div class="grid grid-cols-[minmax(7rem,0.8fr)_1.2fr] gap-3 text-xs">
                        <dt class="font-mono text-base-content/60 break-words">{item.name}</dt>
                        <dd class="font-mono break-words"><For each={item.values.length ? item.values : ["null"]}>{(value) => <div>{value}</div>}</For></dd>
                      </div>
                    )}</For>
                  </dl>
                </section>
              )}
            </For>
          </div>

          <section class="rounded-2xl border border-base-300 overflow-hidden">
            <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-base-200/60">
              <div><h3 class="font-medium">sqlite_schema entries</h3><p class="text-xs text-base-content/60">Internal and user-defined objects as stored by SQLite</p></div>
              <label class="label cursor-pointer gap-2 py-0">
                <span class="label-text text-xs">Internal objects only</span>
                <input type="checkbox" class="toggle toggle-primary toggle-sm" checked={internalOnly()} onChange={(event) => setInternalOnly(event.currentTarget.checked)} />
              </label>
            </div>
            <div class="overflow-auto max-h-96">
              <table class="table table-sm">
                <thead><tr><th>Type</th><th>Name</th><th>Parent</th><th>Root page</th><th>SQL</th></tr></thead>
                <tbody><For each={schemaEntries()}>{(entry) => <tr>
                  <td><span class="badge badge-xs">{entry.object_type}</span></td>
                  <td class="font-mono whitespace-nowrap">{entry.name}</td>
                  <td class="font-mono">{entry.table_name}</td>
                  <td>{entry.root_page}</td>
                  <td class="font-mono text-xs min-w-72 max-w-xl"><div class="whitespace-pre-wrap break-words">{entry.sql || "—"}</div></td>
                </tr>}</For></tbody>
              </table>
              <Show when={schemaEntries().length === 0}><div class="p-6 text-center text-sm text-base-content/60">No schema entries match this filter</div></Show>
            </div>
          </section>
        </div>
      </Show>
    </section>
  );
};

export default SchemaExplorer;
