import { createSignal } from "solid-js";
import * as api from "./api";

// Re-export API types for components to use
export type QueryResult = api.QueryResult;
export type WorkspaceView = "query" | "schema" | "internals";
export type SavedQuery = api.SavedQuery;

export const [apiKey, setApiKey] = createSignal<string>(localStorage.getItem("api_key") || "");
export const [isAuthModalOpen, setIsAuthModalOpen] = createSignal<boolean>(false);

export const [currentDbPath, setCurrentDbPath] = createSignal<string>(localStorage.getItem("last-db-file") || "");
export const [savedQueries, setSavedQueries] = createSignal<api.SavedQuery[]>([]);
export const [activeSavedQueryId, setActiveSavedQueryId] = createSignal<number | null>(null);
export const [isLoadingSavedQueries, setIsLoadingSavedQueries] = createSignal<boolean>(false);
export const [isSaveModalOpen, setIsSaveModalOpen] = createSignal<boolean>(false);

export const [tables, setTables] = createSignal<string[]>([]);
export const [sqlContent, setSqlContent] = createSignal<string>("");
export const [shouldFocusSqlInput, setShouldFocusSqlInput] = createSignal<boolean>(false);
export const [currentTable, setCurrentTable] = createSignal<string | null>(null);
export const [selectedRowIndices, setSelectedRowIndices] = createSignal<number[]>([]);

export const [queryResult, setQueryResult] = createSignal<QueryResult | null>(null);
export const [isQuerying, setIsQuerying] = createSignal<boolean>(false);
export const [isCorrecting, setIsCorrecting] = createSignal<boolean>(false);

export const [workspaceView, setWorkspaceView] = createSignal<WorkspaceView>("query");
export const [databaseSchema, setDatabaseSchema] = createSignal<api.DatabaseSchema | null>(null);
export const [tableSchema, setTableSchema] = createSignal<api.TableSchema | null>(null);
export const [sqliteInternals, setSqliteInternals] = createSignal<api.SqliteInternals | null>(null);
export const [selectedSchemaObject, setSelectedSchemaObject] = createSignal<string | null>(null);
export const [isMetadataLoading, setIsMetadataLoading] = createSignal(false);
export const [metadataError, setMetadataError] = createSignal<string | null>(null);

const onUnauthorized = () => setIsAuthModalOpen(true);
const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

export const resetStore = () => {
    setTables([]);
    setCurrentTable(null);
    setSqlContent("");
    setQueryResult(null);
    setSelectedRowIndices([]);
    setWorkspaceView("query");
    setDatabaseSchema(null);
    setTableSchema(null);
    setSqliteInternals(null);
    setSelectedSchemaObject(null);
    setMetadataError(null);
    setActiveSavedQueryId(null);
};

export const logoutUser = async () => {
    await api.logout();
    localStorage.removeItem("api_key");
    setApiKey("");
    resetStore();
    setIsAuthModalOpen(true);
};

export const fetchTables = async () => {
    try {
        const newTables = await api.fetchTables(apiKey(), onUnauthorized);
        setTables(newTables);
        const selectedTable = currentTable();
        const nextTable = selectedTable && newTables.includes(selectedTable)
            ? selectedTable
            : newTables[0] || null;
        setCurrentTable(nextTable);
        if (nextTable) {
            setSqlContent(`SELECT * FROM ${quoteIdentifier(nextTable)} LIMIT 100`);
            await runQuery();
        } else {
            setSqlContent("");
            setQueryResult(null);
        }
    } catch (e) {
        console.error("Failed to fetch tables", e);
        setTables([]);
        setCurrentTable(null);
        setSqlContent("");
    }
};

const loadSchema = async (selectedName: string | null) => {
    setWorkspaceView("schema");
    setIsMetadataLoading(true);
    setMetadataError(null);
    try {
        const database = await api.fetchDatabaseSchema(apiKey(), onUnauthorized);
        setDatabaseSchema(database);
        const selectedObject = database.objects.find((object) => object.name === selectedName);
        if (selectedObject?.object_type === "table") {
            setTableSchema(await api.fetchTableSchema(selectedObject.name, apiKey(), onUnauthorized));
            setSelectedSchemaObject(selectedObject.name);
        } else {
            setTableSchema(null);
            setSelectedSchemaObject(selectedObject?.name || null);
        }
    } catch (error: any) {
        setMetadataError(error.message);
    } finally {
        setIsMetadataLoading(false);
    }
};

export const openDatabaseSchema = async () => {
    await loadSchema(null);
};

export const openTableSchema = async (name: string) => {
    setCurrentTable(name);
    await loadSchema(name);
};

export const selectSchemaObject = async (object: api.SchemaObject) => {
    if (object.object_type === "table") {
        await openTableSchema(object.name);
    } else {
        setTableSchema(null);
        setSelectedSchemaObject(object.name);
    }
};

export const openSqliteInternals = async () => {
    setWorkspaceView("internals");
    setIsMetadataLoading(true);
    setMetadataError(null);
    try {
        setSqliteInternals(await api.fetchSqliteInternals(apiKey(), onUnauthorized));
    } catch (error: any) {
        setMetadataError(error.message);
    } finally {
        setIsMetadataLoading(false);
    }
};

export const refreshMetadata = async () => {
    if (workspaceView() === "internals") {
        await openSqliteInternals();
    } else if (workspaceView() === "schema") {
        await loadSchema(selectedSchemaObject() || tableSchema()?.name || null);
    }
};

export const execSql = async (sql: string) => {
    return api.execSql(sql, apiKey(), onUnauthorized);
};

export const runQuery = async (sqlOverride?: string) => {
    const sql = sqlOverride || sqlContent();
    if (!sql.trim()) return;

    setIsQuerying(true);
    setQueryResult(null);
    setSelectedRowIndices([]);
    const startTime = performance.now();

    try {
        const data = await execSql(sql);

        setQueryResult(data);

        // Simple side-effect handling: if it's a DDL or DML, refresh related data
        const lowerSql = sql.trim().toLowerCase();
        if (lowerSql.match(/^\s*(create|drop|alter)\s+(table|view|index|trigger)\b/)) {
            await fetchTables();
            await refreshMetadata();
        } else if (lowerSql.match(/^\s*(insert|update|delete)\b/) && currentTable()) {
            // Re-fetch current table data
            const selectSql = `SELECT * FROM ${quoteIdentifier(currentTable()!)} LIMIT 100`;
            const selectData = await execSql(selectSql);
            // Preserve execution stats from the modification query, but show new data
            setQueryResult({
                ...selectData,
                executionTime: data.executionTime,
                affectedRows: data.affectedRows,
            });
        }
    } catch (error: any) {
        setQueryResult({
            columns: [],
            rows: [],
            executionTime: performance.now() - startTime,
            error: error.message
        });
    } finally {
        setIsQuerying(false);
    }
};

export const correctSql = async () => {
    const sql = sqlContent();
    if (!sql) return;

    setIsCorrecting(true);
    try {
        const result = await api.correctSql(sql, currentTable() || "", apiKey(), onUnauthorized);
        if (result.sql) {
            setSqlContent(result.sql);
        } else if (result.error) {
            setQueryResult({
                columns: [],
                rows: [],
                error: `❌ AI Error: ${result.error}`
            });
        }
    } catch (e: any) {
        console.error("Failed to correct SQL", e);
    } finally {
        setIsCorrecting(false);
    }
};

export const fetchSavedQueries = async (targetDb?: string) => {
    const db = targetDb || currentDbPath();
    if (!db) {
        setSavedQueries([]);
        return;
    }
    setIsLoadingSavedQueries(true);
    try {
        const queries = await api.fetchSavedQueries(db, apiKey(), onUnauthorized);
        setSavedQueries(queries);
    } catch (e) {
        console.error("Failed to fetch saved queries", e);
        setSavedQueries([]);
    } finally {
        setIsLoadingSavedQueries(false);
    }
};

export const saveQuery = async (name: string, sql: string, idToUpdate?: number) => {
    const db = currentDbPath();
    if (!db) throw new Error("No database connected");

    if (idToUpdate) {
        const updated = await api.updateSavedQuery(idToUpdate, { name, query: sql }, apiKey(), onUnauthorized);
        setSavedQueries((prev) => prev.map((q) => (q.id === idToUpdate ? updated : q)));
        setActiveSavedQueryId(updated.id);
        return updated;
    } else {
        const created = await api.createSavedQuery(db, name, sql, apiKey(), onUnauthorized);
        setSavedQueries((prev) => [created, ...prev]);
        setActiveSavedQueryId(created.id);
        return created;
    }
};

export const updateSavedQueryName = async (id: number, name: string) => {
    const updated = await api.updateSavedQuery(id, { name }, apiKey(), onUnauthorized);
    setSavedQueries((prev) => prev.map((q) => (q.id === id ? updated : q)));
    return updated;
};

export const removeSavedQuery = async (id: number) => {
    await api.deleteSavedQuery(id, apiKey(), onUnauthorized);
    setSavedQueries((prev) => prev.filter((q) => q.id !== id));
    if (activeSavedQueryId() === id) {
        setActiveSavedQueryId(null);
    }
};

export const loadSavedQuery = (savedQuery: api.SavedQuery) => {
    setActiveSavedQueryId(savedQuery.id);
    setWorkspaceView("query");
    setSqlContent(savedQuery.query);
    setShouldFocusSqlInput(true);
};
