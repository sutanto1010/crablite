import { Component, For, Show, createSignal, onMount, createMemo } from "solid-js";
import Icon from "../components/Icon";
import { isMetadataLoading, metadataError, openSqliteInternals, refreshMetadata, sqliteInternals, pushToast } from "../lib/store";

const InternalsPage: Component = () => {
  const [sectionFilter, setSectionFilter] = createSignal("");
  const internals = () => sqliteInternals();

  onMount(() => {
    openSqliteInternals();
  });

  const matches = (text: string) => text.toLowerCase().includes(sectionFilter().trim().toLowerCase());

  const filteredGroups = createMemo(() => {
    const data = internals();
    if (!data) return [];
    const q = sectionFilter().trim().toLowerCase();
    const groups = [
      { title: "Database", icon: "database", values: data.database },
      { title: "Connection", icon: "cable", values: data.connection },
      { title: "Engine", icon: "memory", values: data.engine },
    ];
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, values: g.values.filter((v) => v.name.toLowerCase().includes(q) || v.values.some((x) => x.toLowerCase().includes(q))) }))
      .filter((g) => g.values.length > 0);
  });

  const filteredEntries = createMemo(() => {
    const q = sectionFilter().trim().toLowerCase();
    return (internals()?.schema_entries || []).filter(
      (e) => !q || e.name.toLowerCase().includes(q) || e.table_name.toLowerCase().includes(q) || e.object_type.toLowerCase().includes(q),
    );
  });

  const copyValue = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      pushToast("success", "Copied");
    } catch {
      pushToast("error", "Copy failed");
    }
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:p-4">
      <div class="flex flex-wrap items-center gap-2">
        <div>
          <h1 class="text-lg font-semibold tracking-tight">SQLite Internals</h1>
          <p class="text-sm text-muted-foreground">Read-only database, connection, and engine metadata for main.</p>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <input class="input h-9 w-52" placeholder="Filter pragmas…" value={sectionFilter()} onInput={(e) => setSectionFilter(e.currentTarget.value)} aria-label="Filter internals" />
          <button type="button" class="btn btn-ghost btn-sm btn-icon" onClick={() => refreshMetadata("internals")} disabled={isMetadataLoading()} title="Refresh internals" aria-label="Refresh internals">
            <Icon name="refresh" class="size-4" />
          </button>
        </div>
      </div>

      <Show when={matches("") && metadataError()}>
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

      <Show when={!isMetadataLoading() && internals()}>
        <div class="grid gap-3 xl:grid-cols-3">
          <For each={filteredGroups()}>
            {(group) => (
              <section class="card p-4" aria-label={group.title}>
                <h2 class="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Icon name={group.icon} class="size-4" />
                  {group.title}
                  <span class="badge badge-secondary ml-auto">{group.values.length}</span>
                </h2>
                <dl class="space-y-2">
                  <For each={group.values}>
                    {(item) => (
                      <div class="rounded-md bg-muted p-2">
                        <dt class="flex items-center gap-2 font-mono text-xs font-medium">
                          {item.name}
                          <button type="button" class="btn btn-ghost btn-sm btn-icon ml-auto size-6" onClick={() => copyValue(`${item.name}: ${item.values.join(" | ")}`)} aria-label={`Copy ${item.name}`}>
                            <Icon name="content_copy" class="size-3.5" />
                          </button>
                        </dt>
                        <dd class="mt-1 space-y-0.5 font-mono text-xs text-muted-foreground">
                          <For each={item.values.slice(0, 6)}>
                            {(v) => <div class="break-all">{v || "—"}</div>}
                          </For>
                          <Show when={item.values.length > 6}>
                            <div class="text-[11px]">+{item.values.length - 6} more</div>
                          </Show>
                        </dd>
                      </div>
                    )}
                  </For>
                </dl>
              </section>
            )}
          </For>
        </div>

        <section class="card overflow-hidden" aria-label="sqlite_schema entries">
          <div class="flex items-center gap-2 border-b border-border px-4 py-3">
            <h2 class="text-sm font-semibold">sqlite_schema entries</h2>
            <span class="badge badge-secondary">{filteredEntries().length}</span>
          </div>
          <div class="max-h-96 overflow-auto">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Name</th>
                  <th scope="col">Table</th>
                  <th scope="col">Root page</th>
                </tr>
              </thead>
              <tbody>
                <For each={filteredEntries()}>
                  {(entry) => (
                    <tr>
                      <td><span class="badge badge-secondary">{entry.object_type}</span></td>
                      <td class="font-mono" title={entry.sql || entry.name}>{entry.name}</td>
                      <td class="font-mono">{entry.table_name}</td>
                      <td class="font-mono">{entry.root_page}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </section>
      </Show>
    </div>
  );
};

export default InternalsPage;
