import { Component, Show } from "solid-js";
import {
  isQuerying, runQuery, currentTable, sqlContent, setSqlContent,
  selectedRowIndices, execSql, setShouldFocusSqlInput, queryResult,
  setIsSaveModalOpen,
} from "../lib/store";
import Icon from "./Icon";

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const Toolbar: Component = () => {
  const handleRefresh = async () => {
    const table = currentTable();
    if (table) {
      setSqlContent(`SELECT * FROM ${quoteIdentifier(table)} LIMIT 100`);
      await runQuery();
    }
  };

  const handleInsert = async () => {
    const table = currentTable();
    if (!table) return;
    try {
      const result = await execSql(`PRAGMA table_info(${quoteIdentifier(table)})`);
      if (result.error) return console.error(result.error);
      const nameIdx = result.columns.findIndex((column) => column.toLowerCase() === "name");
      if (nameIdx === -1) return;
      const columns = result.rows.map((row) => String(row[nameIdx]));
      setSqlContent(
        `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")})\nVALUES (${columns.map(() => "''").join(", ")});`,
      );
      setShouldFocusSqlInput(true);
    } catch (error) {
      console.error("Failed to generate insert statement", error);
    }
  };

  const generateSelectedStatements = async (operation: "update" | "delete") => {
    const table = currentTable();
    const indices = selectedRowIndices();
    const result = queryResult();
    if (!table || indices.length === 0 || !result) return;

    try {
      const info = await execSql(`PRAGMA table_info(${quoteIdentifier(table)})`);
      if (info.error) return console.error(info.error);
      const nameIdx = info.columns.findIndex((column) => column.toLowerCase() === "name");
      const pkIdx = info.columns.findIndex((column) => column.toLowerCase() === "pk");
      if (nameIdx === -1 || pkIdx === -1) return;
      const primaryKeys = info.rows.filter((row) => Number(row[pkIdx]) > 0).map((row) => String(row[nameIdx]));

      const statements = indices.map((index) => {
        const row = result.rows[index];
        const setParts: string[] = [];
        const whereParts: string[] = [];
        result.columns.forEach((column, columnIndex) => {
          const value = row[columnIndex];
          const type = result.columnTypes?.[columnIndex];
          const quotedColumn = quoteIdentifier(column);
          const sqlValue = value === null
            ? "NULL"
            : type === "BLOB" || typeof value === "number"
              ? String(value)
              : `'${String(value).replace(/'/g, "''")}'`;
          if (operation === "update") setParts.push(`${quotedColumn} = ${sqlValue}`);
          if (primaryKeys.length === 0 || primaryKeys.includes(column)) {
            whereParts.push(value === null ? `${quotedColumn} IS NULL` : `${quotedColumn} = ${sqlValue}`);
          }
        });
        return operation === "update"
          ? `UPDATE ${quoteIdentifier(table)} SET ${setParts.join(", ")} WHERE ${whereParts.join(" AND ")};`
          : `DELETE FROM ${quoteIdentifier(table)} WHERE ${whereParts.join(" AND ")};`;
      });
      setSqlContent(statements.join("\n\n"));
      setShouldFocusSqlInput(true);
    } catch (error) {
      console.error(`Failed to generate ${operation} statement`, error);
    }
  };

  return (
    <div class="flex flex-wrap items-center gap-2" aria-label="Query actions">
      <button class="btn btn-sm btn-primary" onClick={() => runQuery()} disabled={isQuerying() || !sqlContent().trim()}>
        <Show when={!isQuerying()} fallback={<span class="loading loading-spinner loading-xs" />}>
          <Icon name="play_arrow" filled />
        </Show>
        Run query
      </button>
      <button
        class="btn btn-sm btn-outline"
        onClick={() => setIsSaveModalOpen(true)}
        disabled={!sqlContent().trim()}
        title="Save query"
      >
        <Icon name="save" /> Save query
      </button>
      <div class="w-px h-6 bg-base-300 mx-1 hidden sm:block" />
      <button class="btn btn-sm btn-outline" onClick={handleInsert} disabled={!currentTable()}>
        <Icon name="add" /> Insert
      </button>
      <button class="btn btn-sm btn-outline" disabled={selectedRowIndices().length === 0} onClick={() => generateSelectedStatements("update")}>
        <Icon name="edit" /> Edit
      </button>
      <button class="btn btn-sm btn-outline text-error" disabled={selectedRowIndices().length === 0} onClick={() => generateSelectedStatements("delete")}>
        <Icon name="delete" /> Delete
      </button>
      <button class="btn btn-sm btn-ghost btn-square ml-auto" title="Refresh rows" aria-label="Refresh rows" onClick={handleRefresh} disabled={isQuerying() || !currentTable()}>
        <Icon name="refresh" />
      </button>
    </div>
  );
};

export default Toolbar;
