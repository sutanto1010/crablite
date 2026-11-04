import { createSignal, createMemo } from "solid-js";
import * as api from "./api";

export type QueryResult = api.QueryResult;
export type SavedQuery = api.SavedQuery;
export type DbFileInfo = api.DbFileInfo;

export interface QueryTab {
    id: string;
    name: string;
    sql: string;
    result: QueryResult | null;
    page: number;
    pageSize: number;
}

export interface Toast {
    id: number;
    kind: "error" | "success" | "info";
    message: string;
}

const uid = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
let toastId = 0;

export const [apiKey, setApiKey] = createSignal<string>(localStorage.getItem("api_key") || "");
export const [isAuthModalOpen, setIsAuthModalOpen] = createSignal<boolean>(false);
export const [toasts, setToasts] = createSignal<Toast[]>([]);

export const [theme, setTheme] = createSignal<"light" | "dark">(
    (localStorage.getItem("theme") as "light" | "dark" | null) || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
);

export const applyTheme = (value: "light" | "dark") => {
    setTheme(value);
    localStorage.setItem("theme", value);
    document.documentElement.classList.toggle("dark", value === "dark");
};

export const [currentDbPath, setCurrentDbPath] = createSignal<string>(localStorage.getItem("last-db-file") || "");
export const [dbFiles, setDbFiles] = createSignal<DbFileInfo[]>([]);
export const [isLoadingDbFiles, setIsLoadingDbFiles] = createSignal(false);

export const [savedQueries, setSavedQueries] = createSignal<api.SavedQuery[]>([]);
export const [savedSearch, setSavedSearch] = createSignal("");
export const [savedTag, setSavedTag] = createSignal("");
export const [isLoadingSavedQueries, setIsLoadingSavedQueries] = createSignal<boolean>(false);
export const [isSaveModalOpen, setIsSaveModalOpen] = createSignal<boolean>(false);

export const [tables, setTables] = createSignal<string[]>([]);
export const [currentTable, setCurrentTable] = createSignal<string | null>(null);

const defaultTab = (): QueryTab => ({ id: uid(), name: "Query 1", sql: "", result: null, page: 1, pageSize: 100 });
export const [tabs, setTabs] = createSignal<QueryTab[]>([defaultTab()]);
export const [activeTabId, setActiveTabId] = createSignal<string>(tabs()[0].id);
export const activeTab = createMemo(() => tabs().find((t) => t.id === activeTabId()) ?? tabs()[0]);

export const [queryHistory, setQueryHistory] = createSignal<{ sql: string; at: number }[]>([]);
export const [isQuerying, setIsQuerying] = createSignal<boolean>(false);
export const [isCorrecting, setIsCorrecting] = createSignal<boolean>(false);
export const [lastExecutionMs, setLastExecutionMs] = createSignal<number | null>(null);

export const [databaseSchema, setDatabaseSchema] = createSignal<api.DatabaseSchema | null>(null);
export const [tableSchema, setTableSchema] = createSignal<api.TableSchema | null>(null);
export const [sqliteInternals, setSqliteInternals] = createSignal<api.SqliteInternals | null>(null);
export const [selectedSchemaObject, setSelectedSchemaObject] = createSignal<string | null>(null);
export const [isMetadataLoading, setIsMetadataLoading] = createSignal(false);
export const [metadataError, setMetadataError] = createSignal<string | null>(null);
export const [health, setHealth] = createSignal<api.HealthResult | null>(null);

export const [paletteOpen, setPaletteOpen] = createSignal(false);

const onUnauthorized = () => setIsAuthModalOpen(true);
export const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

export const pushToast = (kind: Toast["kind"], message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
};

export const dismissToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

export const resetStore = () => {
    setTables([]);
    setCurrentTable(null);
    setTabs([defaultTab()]);
    setActiveTabId(tabs()[0].id);
    setDatabaseSchema(null);
    setTableSchema(null);
    setSqliteInternals(null);
    setSelectedSchemaObject(null);
    setMetadataError(null);
};

export const logoutUser = async () => {
    await api.logout();
    localStorage.removeItem("api_key");
    setApiKey("");
    resetStore();
    setIsAuthModalOpen(true);
};

export const refreshHealth = async () => {
    try {
        setHealth(await api.getHealth());
    } catch {
        setHealth(null);
    }
};

export const fetchDbFiles = async () => {
    setIsLoadingDbFiles(true);
    try {
        setDbFiles(await api.getDbFiles(apiKey(), onUnauthorized));
    } catch (e: any) {
        if (e?.message !== "Unauthorized") pushToast("error", e?.message || "Failed to fetch db files");
        setDbFiles([]);
    } finally {
        setIsLoadingDbFiles(false);
    }
};

export const connectDatabase = async (path: string, create: boolean) => {
    const result = await api.connectDb(path, create, apiKey(), onUnauthorized);
    if (!result.success) throw new Error(`Connect failed (status ${result.status})`);
    localStorage.setItem("last-db-file", path);
    setCurrentDbPath(path);
    resetStore();
    await Promise.all([fetchTables(), fetchSavedQueries()]);
};

export const fetchTables = async () => {
    try {
        const next = await api.fetchTables(apiKey(), onUnauthorized);
        setTables(next);
        const selected = currentTable();
        const table = selected && next.includes(selected) ? selected : next[0] || null;
        setCurrentTable(table);
        if (table && !activeTab().sql.trim()) {
            updateActiveTab({ sql: `SELECT * FROM ${quoteIdentifier(table)} LIMIT 100` });
        }
    } catch (e: any) {
        if (e?.message !== "Unauthorized") pushToast("error", e?.message || "Failed to fetch tables");
        setTables([]);
        setCurrentTable(null);
    }
};

export const loadSchema = async (selectedName: string | null) => {
    setIsMetadataLoading(true);
    setMetadataError(null);
    try {
        const database = await api.fetchDatabaseSchema(apiKey(), onUnauthorized);
        setDatabaseSchema(database);
        const selectedObject = database.objects.find((object) => object.name === selectedName);
        if (selectedObject?.object_type === "table") {
            setTableSchema(await api.fetchTableSchema(selectedObject.name, apiKey(), onUnauthorized));
            setSelectedSchemaObject(selectedObject.name);
            setCurrentTable(selectedObject.name);
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

export const openTableSchema = async (name: string) => {
    setCurrentTable(name);
    await loadSchema(name);
};

export const selectSchemaObject = async (object: api.SchemaObject) => {
    if (object.object_type === "table") await openTableSchema(object.name);
    else {
        setTableSchema(null);
        setSelectedSchemaObject(object.name);
    }
};

export const openSqliteInternals = async () => {
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

export const refreshMetadata = async (view: string) => {
    if (view === "internals") await openSqliteInternals();
    else if (view === "schema") await loadSchema(selectedSchemaObject() || tableSchema()?.name || null);
};

export const allSavedTags = createMemo(() => {
    const tags = new Set<string>();
    for (const q of savedQueries()) {
        for (const t of (q.tags || "").split(",").map((s) => s.trim()).filter(Boolean)) tags.add(t);
    }
    return [...tags].sort();
});

export const fetchSavedQueries = async () => {
    const db = currentDbPath();
    if (!db) {
        setSavedQueries([]);
        return;
    }
    setIsLoadingSavedQueries(true);
    try {
        const queries = await api.fetchSavedQueries(db, apiKey(), { search: savedSearch(), tag: savedTag() }, onUnauthorized);
        setSavedQueries(queries);
    } catch (e: any) {
        if (e?.message !== "Unauthorized") pushToast("error", e?.message || "Failed to fetch saved queries");
        setSavedQueries([]);
    } finally {
        setIsLoadingSavedQueries(false);
    }
};

export const saveQuery = async (name: string, sql: string, tags: string, idToUpdate?: number) => {
    const db = currentDbPath();
    if (!db) throw new Error("No database connected");
    if (idToUpdate) {
        const updated = await api.updateSavedQuery(idToUpdate, { name, query: sql, tags }, apiKey(), onUnauthorized);
        setSavedQueries((prev) => prev.map((q) => (q.id === idToUpdate ? updated : q)));
        return updated;
    }
    const created = await api.createSavedQuery(db, name, sql, apiKey(), tags, onUnauthorized);
    setSavedQueries((prev) => [created, ...prev]);
    return created;
};

export const removeSavedQuery = async (id: number) => {
    await api.deleteSavedQuery(id, apiKey(), onUnauthorized);
    setSavedQueries((prev) => prev.filter((q) => q.id !== id));
};

export const updateActiveTab = (patch: Partial<QueryTab>) => {
    const id = activeTabId();
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
};

export const addTab = (sql = "") => {
    const tab: QueryTab = { id: uid(), name: `Query ${tabs().length + 1}`, sql, result: null, page: 1, pageSize: 100 };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
};

export const closeTab = (id: string) => {
    setTabs((prev) => {
        if (prev.length === 1) return [{ ...prev[0], result: null, page: 1 }];
        const next = prev.filter((t) => t.id !== id);
        if (id === activeTabId()) setActiveTabId(next[next.length - 1].id);
        return next;
    });
};

export const runQuery = async (sqlOverride?: string, pageOverride?: number) => {
    const tab = activeTab();
    const sql = (sqlOverride ?? tab.sql).trim();
    if (!sql || isQuerying()) return;
    const pageSize = tab.pageSize;
    const page = pageOverride ?? tab.page;
    const offset = (page - 1) * pageSize;
    setIsQuerying(true);
    updateActiveTab({ sql, page });
    const startTime = performance.now();
    try {
        const data = await api.execSql(sql, apiKey(), { limit: pageSize, offset }, onUnauthorized);
        setLastExecutionMs(data.executionTime ?? performance.now() - startTime);
        updateActiveTab({ result: data });
        setQueryHistory((prev) => [{ sql, at: Date.now() }, ...prev].slice(0, 50));
        const lower = sql.toLowerCase();
        if (/^\s*(create|drop|alter)\s+(table|view|index|trigger)\b/.test(lower)) {
            await fetchTables();
        }
    } catch (error: any) {
        updateActiveTab({
            result: {
                columns: [],
                rows: [],
                executionTime: performance.now() - startTime,
                error: error.message,
                totalRows: null,
                limit: pageSize,
                offset,
            },
        });
        pushToast("error", error.message);
    } finally {
        setIsQuerying(false);
    }
};

export const correctSql = async () => {
    const tab = activeTab();
    if (!tab.sql.trim() || isCorrecting()) return;
    setIsCorrecting(true);
    try {
        const result = await api.correctSql(tab.sql, currentTable() || "", apiKey(), onUnauthorized);
        if (result.sql) {
            updateActiveTab({ sql: result.sql });
            pushToast("success", "SQL corrected by AI");
        } else if (result.error) {
            pushToast("error", `AI Error: ${result.error}`);
        }
    } catch (e: any) {
        pushToast("error", e?.message || "Failed to correct SQL");
    } finally {
        setIsCorrecting(false);
    }
};

export const openTablePreview = async (name: string) => {
    setCurrentTable(name);
    if (tabs().length === 0) addTab();
    updateActiveTab({ sql: `SELECT * FROM ${quoteIdentifier(name)} LIMIT 100`, page: 1 });
    await runQuery(`SELECT * FROM ${quoteIdentifier(name)} LIMIT 100`, 1);
};
