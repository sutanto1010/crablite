import { Component, For, Show, createSignal, createMemo, createEffect } from "solid-js";
import { Portal } from "solid-js/web";
import { useNavigate } from "@solidjs/router";
import { paletteOpen, setPaletteOpen, tables, openTablePreview, runQuery, addTab, setIsSaveModalOpen, currentTable } from "../lib/store";
import Icon from "./Icon";

const CommandPalette: Component = () => {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal("");
  const [index, setIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  const actions = () => [
    { kind: "Go to Query", hint: "/", run: () => navigate("/") },
    { kind: "Go to Schema", hint: "/schema", run: () => navigate("/schema") },
    { kind: "Go to Internals", hint: "/internals", run: () => navigate("/internals") },
    { kind: "Go to Saved Queries", hint: "/saved", run: () => navigate("/saved") },
    { kind: "Go to Databases", hint: "/databases", run: () => navigate("/databases") },
    { kind: "Run query", hint: "Ctrl+Enter", run: () => runQuery() },
    { kind: "New tab", hint: "", run: () => addTab() },
    { kind: "Save query", hint: "Ctrl+S", run: () => setIsSaveModalOpen(true) },
  ];

  const items = createMemo(() => {
    const q = query().trim().toLowerCase();
    const tableItems = tables()
      .filter((t) => !q || t.toLowerCase().includes(q))
      .slice(0, 8)
      .map((t) => ({ label: `Open table ${t}`, group: "Tables", run: () => openTablePreview(t) }));
    const actionItems = actions()
      .filter((a) => !q || a.kind.toLowerCase().includes(q))
      .map((a) => ({ label: a.kind, group: `Actions · ${a.hint}`, run: a.run }));
    return [...tableItems, ...actionItems].slice(0, 12);
  });

  createEffect(() => {
    if (paletteOpen()) {
      setQuery("");
      setIndex(0);
      queueMicrotask(() => inputRef?.focus());
    }
  });

  const close = () => setPaletteOpen(false);

  const onKey = (e: KeyboardEvent) => {
    if (!paletteOpen()) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, items().length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items()[index()]?.run();
      close();
      if (currentTable()) navigate("/");
    }
  };

  return (
    <Show when={paletteOpen()}>
      <Portal>
        <div class="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-4 pt-24" role="presentation" onClick={close}>
          <div role="dialog" aria-modal="true" aria-label="Command palette" class="card w-full max-w-lg overflow-hidden shadow-xl" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
            <div class="flex items-center gap-2 border-b border-border p-3">
              <Icon name="search" class="size-4 text-muted-foreground" />
              <input
                ref={inputRef}
                class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                placeholder="Type a table, action, or route…"
                value={query()}
                onInput={(e) => {
                  setQuery(e.currentTarget.value);
                  setIndex(0);
                }}
                aria-label="Search tables and actions"
              />
              <span class="kbd">esc</span>
            </div>
            <ul class="max-h-72 overflow-y-auto p-1.5" role="listbox" aria-label="Results">
              <For each={items()}>
                {(item, i) => (
                  <li role="option" aria-selected={i() === index()}>
                    <button
                      type="button"
                      class={`sidebar-item ${i() === index() ? "bg-accent text-foreground" : ""}`}
                      data-active={false}
                      onMouseEnter={() => setIndex(i())}
                      onClick={() => {
                        item.run();
                        close();
                      }}
                    >
                      <Icon name="bolt" class="size-4 shrink-0" />
                      <span class="truncate">{item.label}</span>
                      <span class="ml-auto truncate text-xs text-muted-foreground">{item.group}</span>
                    </button>
                  </li>
                )}
              </For>
              <Show when={items().length === 0}>
                <li class="p-4 text-center text-sm text-muted-foreground">No matches.</li>
              </Show>
            </ul>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export default CommandPalette;
