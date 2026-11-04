import { Component, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { tables, currentTable, openTablePreview, currentDbPath, setPaletteOpen } from "../lib/store";
import Icon from "./Icon";

const ExplorerSidebar: Component = () => {
  return (
    <aside aria-label="Explorer" class="hidden w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-card p-3 md:flex">
      <div class="flex items-center justify-between">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Explorer</h2>
        <button type="button" class="btn btn-ghost btn-sm btn-icon" onClick={() => setPaletteOpen(true)} title="Jump to table or action (Ctrl+K)" aria-label="Open command palette">
          <Icon name="search" class="size-4" />
        </button>
      </div>

      <Show when={currentDbPath()} fallback={<p class="rounded-md bg-muted p-3 text-xs text-muted-foreground">Connect a database to browse tables.</p>}>
        <section aria-label="Tables">
          <div class="mb-1.5 flex items-center justify-between">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tables ({tables().length})</h3>
            <A href="/schema" class="text-xs text-primary hover:underline">
              Schema
            </A>
          </div>
          <Show when={tables().length > 0} fallback={<p class="text-xs text-muted-foreground">No tables found.</p>}>
            <ul class="flex flex-col gap-0.5" role="list">
              <For each={tables()}>
                {(name) => (
                  <li>
                    <button type="button" class="sidebar-item font-mono text-[13px]" data-active={currentTable() === name} onClick={() => openTablePreview(name)} title={`Preview ${name}`}>
                      <Icon name="table" class="size-4 shrink-0" />
                      <span class="truncate">{name}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </Show>

      <section aria-label="Shortcuts" class="mt-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
        <div class="mb-1 font-semibold uppercase tracking-wider">Shortcuts</div>
        <ul class="space-y-1">
          <li>
            <span class="kbd">Ctrl+Enter</span> run query
          </li>
          <li>
            <span class="kbd">Ctrl+K</span> palette
          </li>
          <li>
            <span class="kbd">Ctrl+S</span> save query
          </li>
        </ul>
      </section>
    </aside>
  );
};

export default ExplorerSidebar;
