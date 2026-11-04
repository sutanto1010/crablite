import { Component, For, Show, createSignal, createMemo } from "solid-js";
import { activeTab, runQuery, isQuerying, pushToast, updateActiveTab } from "../lib/store";
import Icon from "./Icon";

const PAGE_SIZES = [50, 100, 250, 500];

const formatCell = (value: unknown): string => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const toCsv = (columns: string[], rows: any[][]): string => {
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
};

const DataGrid: Component = () => {
  const [selected, setSelected] = createSignal<Set<number>>(new Set());
  const [sort, setSort] = createSignal<{ col: number; dir: 1 | -1 } | null>(null);
  const result = () => activeTab().result;

  const sortedRows = createMemo(() => {
    const res = result();
    if (!res) return [];
    const s = sort();
    if (!s) return res.rows;
    return [...res.rows].sort((a, b) => {
      const av = a[s.col];
      const bv = b[s.col];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return (av < bv ? -1 : 1) * s.dir;
    });
  });

  const totalPages = () => {
    const res = result();
    if (!res?.totalRows || !res.limit) return 1;
    return Math.max(1, Math.ceil(res.totalRows / res.limit));
  };
  const page = () => activeTab().page;

  const copySelected = async () => {
    const res = result();
    if (!res) return;
    const sel = [...selected()];
    const rows = (sel.length ? sel.map((i) => res.rows[i]).filter(Boolean) : res.rows).map((r) => r.map(formatCell).join("\t")).join("\n");
    try {
      await navigator.clipboard.writeText(rows);
      pushToast("success", sel.length ? `Copied ${sel.length} row(s)` : "Copied all rows (TSV)");
    } catch {
      pushToast("error", "Clipboard copy failed");
    }
  };

  const exportCsv = () => {
    const res = result();
    if (!res) return;
    const blob = new Blob([toCsv(res.columns, res.rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `query-page-${page()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast("success", "Exported current page as CSV");
  };

  const toggleSort = (col: number) => {
    const s = sort();
    if (!s || s.col !== col) setSort({ col, dir: 1 });
    else if (s.dir === 1) setSort({ col, dir: -1 });
    else setSort(null);
  };

  const toggleRow = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    const res = result();
    if (!res) return;
    setSelected((prev) => (prev.size === res.rows.length ? new Set<number>() : new Set<number>(res.rows.map((_, i) => i))));
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2">
      <Show when={result()?.error}>
        <div class="alert alert-error text-sm" role="alert">
          <Icon name="error" class="size-4 shrink-0" />
          <span class="break-words font-mono text-xs">{result()!.error}</span>
        </div>
      </Show>

      <Show when={result() && !result()!.error}>
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
          <span class="badge badge-secondary font-mono">
            {result()!.totalRows != null ? `${result()!.totalRows} rows total` : `${result()!.rows.length} rows`} · page {page()}/{totalPages()}
          </span>
          <Show when={result()!.executionTime != null}>
            <span class="font-mono">{result()!.executionTime!.toFixed(1)} ms</span>
          </Show>
          <Show when={result()!.affectedRows != null}>
            <span>{result()!.affectedRows} affected</span>
          </Show>
          <div class="ml-auto flex items-center gap-1.5">
            <label class="flex items-center gap-1.5">
              <span class="sr-only">Rows per page</span>
              <select
                class="select h-8 w-auto py-1 text-xs"
                value={activeTab().pageSize}
                onChange={(e) => {
                  updateActiveTab({ pageSize: Number(e.currentTarget.value), page: 1 });
                  runQuery(undefined, 1);
                }}
                aria-label="Rows per page"
              >
                <For each={PAGE_SIZES}>{(size) => <option value={size}>{size}/page</option>}</For>
              </select>
            </label>
            <button type="button" class="btn btn-ghost btn-sm" onClick={copySelected} title="Copy rows as TSV">
              <Icon name="content_copy" class="size-4" />
              Copy
            </button>
            <button type="button" class="btn btn-ghost btn-sm" onClick={exportCsv} title="Export current page as CSV">
              <Icon name="download" class="size-4" />
              CSV
            </button>
          </div>
        </div>

        <Show when={result()!.columns.length > 0} fallback={<p class="rounded-md bg-muted p-4 text-sm text-muted-foreground">Query executed. No columns returned.</p>}>
          <div class="min-h-0 flex-1 overflow-auto rounded-md border border-border" tabindex="0" aria-label="Query results table">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col" class="w-10">
                    <input
                      type="checkbox"
                      class="checkbox"
                      checked={result()!.rows.length > 0 && selected().size === result()!.rows.length}
                      onChange={toggleAll}
                      aria-label="Select all rows"
                    />
                  </th>
                  <th scope="col" class="w-12">#</th>
                  <For each={result()!.columns}>
                    {(col, i) => (
                      <th scope="col">
                        <button type="button" class="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(i())} aria-label={`Sort by ${col}`}>
                          <span class="truncate">{col}</span>
                          <Show when={sort()?.col === i()}>
                            <span aria-hidden="true">{sort()!.dir === 1 ? "↑" : "↓"}</span>
                          </Show>
                        </button>
                        <Show when={result()!.columnTypes?.[i()]}>
                          <div class="font-mono font-normal normal-case tracking-normal opacity-70">{result()!.columnTypes![i()]}</div>
                        </Show>
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={sortedRows()}>
                  {(row, i) => (
                    <tr data-selected={selected().has(i())}>
                      <td>
                        <input type="checkbox" checked={selected().has(i())} onChange={() => toggleRow(i())} aria-label={`Select row ${i() + 1}`} />
                      </td>
                      <td class="font-mono text-muted-foreground">{(page() - 1) * (result()!.limit ?? result()!.rows.length) + i() + 1}</td>
                      <For each={row}>
                        {(cell) => (
                          <td title={formatCell(cell)}>
                            <span class={cell === null ? "font-mono italic text-muted-foreground" : "font-mono"}>{formatCell(cell)}</span>
                          </td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <div class="flex items-center justify-between gap-2 text-xs">
            <button type="button" class="btn btn-outline btn-sm" disabled={page() <= 1 || isQuerying()} onClick={() => runQuery(undefined, page() - 1)}>
              <Icon name="chevron_left" class="size-4" /> Prev
            </button>
            <span class="font-mono text-muted-foreground" aria-live="polite">
              Page {page()} of {totalPages()}
            </span>
            <button type="button" class="btn btn-outline btn-sm" disabled={page() >= totalPages() || isQuerying()} onClick={() => runQuery(undefined, page() + 1)}>
              Next <Icon name="chevron_right" class="size-4" />
            </button>
          </div>
        </Show>
      </Show>

      <Show when={!result()}>
        <div class="grid flex-1 place-items-center rounded-md border border-dashed border-border p-8 text-center">
          <div>
            <Icon name="terminal" class="mx-auto mb-2 size-8 text-muted-foreground" />
            <p class="text-sm font-medium">No results yet</p>
            <p class="mt-1 text-xs text-muted-foreground">
              Write SQL above and press <span class="kbd">Ctrl+Enter</span> to run.
            </p>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default DataGrid;
