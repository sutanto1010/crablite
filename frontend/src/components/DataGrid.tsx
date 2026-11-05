import { Component, For, Show, createSignal, createMemo, createEffect } from "solid-js";
import { activeTab, activeTabId, runQuery, isQuerying, pushToast, updateActiveTab, apiKey, setIsAuthModalOpen, quoteIdentifier } from "../lib/store";
import { execSql as execRawSql, fetchTableSchema } from "../lib/api";
import type { TableSchema } from "../lib/api";
import Icon from "./Icon";
import Dialog from "./Dialog";

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

// Extract the single source table from a plain SELECT so bulk actions can
// target it with a PK predicate. Returns null for anything ambiguous
// (joins, multi-table FROM, set ops, aggregations) to avoid wrong WHEREs.
const SINGLE_TABLE_RE = /FROM\s+(?:"([^"]+)"|'([^']+)'|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][\w$]*))/i;

const detectSingleTable = (sql: string): string | null => {
  const withoutComments = sql.replace(/--[^\n]*$/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  const trimmed = withoutComments.trim().replace(/;+\s*$/, "");
  if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) return null;
  if (/\b(UNION|EXCEPT|INTERSECT)\b/i.test(trimmed)) return null;
  if (/\bJOIN\b/i.test(trimmed)) return null;
  if (/\bGROUP\s+BY\b/i.test(trimmed) || /\bHAVING\b/i.test(trimmed)) return null;
  if (/\bCOUNT\s*\(|\bSUM\s*\(|\bAVG\s*\(|\bMIN\s*\(|\bMAX\s*\(|\bGROUP_CONCAT\s*\(/i.test(trimmed)) return null;
  const m = SINGLE_TABLE_RE.exec(trimmed);
  if (!m) return null;
  const table = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
  if (!table) return null;
  const rest = trimmed.slice(m.index + m[0].length).trimStart();
  if (/^,/.test(rest)) return null;
  if (/^(INNER|LEFT|RIGHT|FULL|CROSS|OUTER|NATURAL|JOIN)\b/i.test(rest)) return null;
  return table;
};

// Encode a JSON cell value as a SQLite literal for generated WHERE clauses.
const encodeLiteral = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") {
    if (/^x'[0-9A-Fa-f]+'$/.test(v)) return v; // BLOB hex literal from backend
    return `'${v.replace(/'/g, "''")}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
};

const DataGrid: Component = () => {
  const [selected, setSelected] = createSignal<Set<number>>(new Set());
  const [sort, setSort] = createSignal<{ col: number; dir: 1 | -1 } | null>(null);
  const [bulkSchema, setBulkSchema] = createSignal<TableSchema | null>(null);
  const [bulkSchemaTable, setBulkSchemaTable] = createSignal<string | null>(null);
  const [confirmKind, setConfirmKind] = createSignal<"delete" | "duplicate" | null>(null);
  const [bulkRunning, setBulkRunning] = createSignal(false);
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

  // Selection is page-local: clear it whenever the result, tab, or sort changes.
  createEffect(() => {
    result();
    activeTabId();
    setSelected(new Set());
  });
  createEffect(() => {
    sort();
    setSelected(new Set());
  });

  const detectedTable = createMemo(() => detectSingleTable(activeTab().sql));

  // Load the source table schema lazily once rows are selected.
  createEffect(() => {
    const table = detectedTable();
    if (!table || selected().size === 0) return;
    if (bulkSchemaTable() === table && bulkSchema()) return;
    setBulkSchemaTable(table);
    fetchTableSchema(table, apiKey(), () => setIsAuthModalOpen(true))
      .then((schema) => {
        if (bulkSchemaTable() === table) setBulkSchema(schema);
      })
      .catch(() => {
        if (bulkSchemaTable() === table) setBulkSchema(null);
      });
  });

  const pkCols = createMemo(() => {
    const schema = bulkSchema();
    if (!schema || bulkSchemaTable() !== detectedTable()) return null;
    const pks = schema.columns
      .filter((c) => c.primary_key_position > 0)
      .sort((a, b) => a.primary_key_position - b.primary_key_position)
      .map((c) => c.name);
    return pks.length > 0 ? pks : null;
  });

  // Index of each PK column inside the result columns (null when a PK is missing).
  const pkIdx = createMemo(() => {
    const res = result();
    const pks = pkCols();
    if (!res || !pks) return null;
    const idx = pks.map((pk) => {
      const exact = res.columns.indexOf(pk);
      if (exact >= 0) return exact;
      return res.columns.findIndex((c) => c.toLowerCase() === pk.toLowerCase());
    });
    return idx.every((i) => i >= 0) ? idx : null;
  });

  const rowEligible = () => detectedTable() !== null && pkIdx() !== null;

  const ineligibilityReason = () => {
    if (!result() || result()!.error) return "Run a query first";
    if (detectedTable() === null) return "Bulk edit needs a plain SELECT from one table (no joins, unions, or aggregates)";
    if (!bulkSchema()) return `No editable table schema for "${detectedTable()}" (views and missing PKs are read-only)`;
    if (pkIdx() === null) return "Include the table primary key columns in the SELECT to enable bulk actions";
    return "";
  };

  // Only a single INTEGER PRIMARY KEY is a rowid alias SQLite auto-assigns,
  // so only then can duplicates omit the PK and get fresh ids.
  const autoPkCol = createMemo(() => {
    const schema = bulkSchema();
    if (!schema) return null;
    const pks = schema.columns
      .filter((c) => c.primary_key_position > 0)
      .sort((a, b) => a.primary_key_position - b.primary_key_position);
    if (pks.length !== 1) return null;
    return (pks[0].declared_type || "").trim().toUpperCase() === "INTEGER" ? pks[0].name : null;
  });

  const selectedRows = () => {
    const rows = sortedRows();
    return [...selected()].sort((a, b) => a - b).map((i) => rows[i]).filter((r) => r !== undefined);
  };

  const pkCondition = (row: unknown[], cols: string[], idx: number[]) =>
    idx
      .map((colIdx, k) => {
        const cell = row[colIdx];
        const col = quoteIdentifier(cols[k]);
        return cell === null || cell === undefined ? `${col} IS NULL` : `${col} = ${encodeLiteral(cell)}`;
      })
      .join(" AND ");

  const deleteSql = (): string | null => {
    const table = detectedTable();
    const res = result();
    const idx = pkIdx();
    const pks = pkCols();
    const rows = selectedRows();
    if (!table || !res || !idx || !pks || rows.length === 0) return null;
    const where = rows.map((row) => `(${pkCondition(row, pks, idx)})`).join(" OR ");
    return `DELETE FROM ${quoteIdentifier(table)} WHERE ${where}`;
  };

  const duplicateSql = (): string | null => {
    const table = detectedTable();
    const schema = bulkSchema();
    const idx = pkIdx();
    const pks = pkCols();
    const omitted = autoPkCol();
    const rows = selectedRows();
    if (!table || !schema || !idx || !pks || !omitted || rows.length === 0) return null;
    const insertCols = schema.columns.map((c) => c.name).filter((name) => name !== omitted);
    if (insertCols.length === 0) return null;
    const colList = insertCols.map(quoteIdentifier).join(", ");
    const where = rows.map((row) => `(${pkCondition(row, pks, idx)})`).join(" OR ");
    return `INSERT INTO ${quoteIdentifier(table)} (${colList}) SELECT ${colList} FROM ${quoteIdentifier(table)} WHERE ${where}`;
  };

  const duplicateDisabledReason = () => {
    if (!rowEligible()) return ineligibilityReason();
    if (!autoPkCol()) return "Duplicate needs a single INTEGER PRIMARY KEY so SQLite can assign new ids";
    return "";
  };

  const totalPages = () => {
    const res = result();
    if (!res?.totalRows || !res.limit) return 1;
    return Math.max(1, Math.ceil(res.totalRows / res.limit));
  };
  const page = () => activeTab().page;

  const copySelected = async () => {
    const res = result();
    if (!res) return;
    const rows = sortedRows();
    const sel = [...selected()].sort((a, b) => a - b);
    const data = (sel.length ? sel.map((i) => rows[i]).filter((r) => r !== undefined) : rows).map((r) => r.map(formatCell).join("\t")).join("\n");
    try {
      await navigator.clipboard.writeText(data);
      pushToast("success", sel.length ? `Copied ${sel.length} row(s)` : "Copied all rows (TSV)");
    } catch {
      pushToast("error", "Clipboard copy failed");
    }
  };

  const exportCsv = () => {
    const res = result();
    if (!res) return;
    const rows = sortedRows();
    const sel = [...selected()].sort((a, b) => a - b);
    const data = sel.length ? sel.map((i) => rows[i]).filter((r) => r !== undefined) : rows;
    const blob = new Blob([toCsv(res.columns, data)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sel.length ? `query-page-${page()}-selected.csv` : `query-page-${page()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast("success", sel.length ? `Exported ${sel.length} selected row(s) as CSV` : "Exported current page as CSV");
  };

  const runBulk = async (sql: string, count: number, verb: string) => {
    setBulkRunning(true);
    try {
      const data = await execRawSql(sql, apiKey(), undefined, () => setIsAuthModalOpen(true));
      if (data.error) throw new Error(data.error);
      pushToast("success", `${verb} ${data.affectedRows ?? count} row(s)`);
      setConfirmKind(null);
      setSelected(new Set());
      await runQuery(undefined, page());
    } catch (e: any) {
      pushToast("error", e?.message || `Bulk ${verb.toLowerCase()} failed`);
    } finally {
      setBulkRunning(false);
    }
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

  const previewSql = () => {
    const sql = confirmKind() === "delete" ? deleteSql() : duplicateSql();
    if (!sql) return "";
    return sql.length > 2000 ? `${sql.slice(0, 2000)}\n-- … (${selected().size} rows)` : sql;
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
            <button type="button" class="btn btn-ghost btn-sm" onClick={copySelected} title="Copy rows as TSV (selection or page)">
              <Icon name="content_copy" class="size-4" />
              Copy
            </button>
            <button type="button" class="btn btn-ghost btn-sm" onClick={exportCsv} title="Export as CSV (selection or page)">
              <Icon name="download" class="size-4" />
              CSV
            </button>
          </div>
        </div>

        <Show when={selected().size > 0}>
          <div class="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs" role="toolbar" aria-label="Bulk actions for selected rows">
            <span class="font-semibold">{selected().size} selected</span>
            <span class="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                class="btn btn-error btn-sm"
                disabled={!rowEligible()}
                title={rowEligible() ? `Delete ${selected().size} row(s)` : ineligibilityReason()}
                onClick={() => setConfirmKind("delete")}
              >
                <Icon name="delete" class="size-4" />
                Delete
              </button>
              <button
                type="button"
                class="btn btn-outline btn-sm"
                disabled={duplicateDisabledReason() !== ""}
                title={duplicateDisabledReason() || `Duplicate ${selected().size} row(s)`}
                onClick={() => setConfirmKind("duplicate")}
              >
                <Icon name="add" class="size-4" />
                Duplicate
              </button>
              <button type="button" class="btn btn-ghost btn-sm" onClick={copySelected} title="Copy selected rows as TSV">
                <Icon name="content_copy" class="size-4" />
                Copy
              </button>
              <button type="button" class="btn btn-ghost btn-sm" onClick={exportCsv} title="Export selected rows as CSV">
                <Icon name="download" class="size-4" />
                CSV
              </button>
              <button type="button" class="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())} title="Clear selection">
                <Icon name="close" class="size-4" />
                Clear
              </button>
            </span>
            <Show when={!rowEligible()}>
              <span class="text-muted-foreground">{ineligibilityReason()}</span>
            </Show>
          </div>
        </Show>

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

      <Dialog
        open={confirmKind() !== null}
        onClose={() => {
          if (!bulkRunning()) setConfirmKind(null);
        }}
        title={confirmKind() === "delete" ? `Delete ${selected().size} row(s)?` : `Duplicate ${selected().size} row(s)?`}
        icon={confirmKind() === "delete" ? "delete" : "add"}
        footer={
          <>
            <button type="button" class="btn btn-ghost btn-sm" disabled={bulkRunning()} onClick={() => setConfirmKind(null)}>
              Cancel
            </button>
            <button
              type="button"
              class={`btn btn-sm ${confirmKind() === "delete" ? "btn-error" : "btn-default"}`}
              disabled={bulkRunning() || previewSql() === ""}
              onClick={() => {
                const sql = confirmKind() === "delete" ? deleteSql() : duplicateSql();
                if (!sql) {
                  pushToast("error", confirmKind() === "delete" ? "Cannot build DELETE: missing primary key values" : "Duplicate needs a single INTEGER PRIMARY KEY");
                  return;
                }
                void runBulk(sql, selected().size, confirmKind() === "delete" ? "Deleted" : "Duplicated");
              }}
            >
              {bulkRunning() ? "Running…" : confirmKind() === "delete" ? "Delete" : "Duplicate"}
            </button>
          </>
        }
      >
        <p class="text-sm text-muted-foreground">
          {confirmKind() === "delete"
            ? `This permanently deletes ${selected().size} row(s) from ${detectedTable() ?? "the table"}.`
            : `This inserts ${selected().size} copie(s) into ${detectedTable() ?? "the table"} with new ids.`}
        </p>
        <pre class="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">{previewSql()}</pre>
      </Dialog>
    </div>
  );
};

export default DataGrid;
