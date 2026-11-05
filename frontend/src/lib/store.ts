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

// --- Persistent tabs (localStorage, scoped per DB) ---
type PersistedTab = { id: string; name: string; sql: string };
type PersistedState = { v: 1; tabs: PersistedTab[]; activeTabId: string };

const MAX_PERSISTED_TABS = 20;
const MAX_SQL_CHARS = 100_000;

const tabsKey = (dbPath: string) => `crablite:tabs:${dbPath || "__none__"}`;

const sanitizePersisted = (raw: unknown): PersistedState | null => {
    if (!raw || typeof raw !== "object") return null;
    const parsed = raw as Partial<PersistedState>;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    const seen = new Set<string>();
    const tabs: PersistedTab[] = [];
    for (const entry of parsed.tabs.slice(0, MAX_PERSISTED_TABS)) {
        const e = entry as Partial<PersistedTab>;
        if (typeof e.sql !== "string" || typeof e.name !== "string") continue;
        let id = typeof e.id === "string" && e.id ? e.id : uid();
        if (seen.has(id)) id = uid();
        seen.add(id);
        tabs.push({ id, name: e.name.slice(0, 100) || "Query", sql: e.sql.slice(0, MAX_SQL_CHARS) });
    }
    if (tabs.length === 0) return null;
    const activeTabId = typeof parsed.activeTabId === "string" && seen.has(parsed.activeTabId) ? parsed.activeTabId : tabs[0].id;
    return { v: 1, tabs, activeTabId };
};

const loadTabsForDb = (dbPath: string): PersistedState | null => {
    try {
        const raw = localStorage.getItem(tabsKey(dbPath));
        if (!raw) return null;
        return sanitizePersisted(JSON.parse(raw));
    } catch {
        return null;
    }
};

const toQueryTabs = (persisted: PersistedState): QueryTab[] =>
    persisted.tabs.map((t) => ({ id: t.id, name: t.name, sql: t.sql, result: null, page: 1, pageSize: 100 }));

const initialDbPath = localStorage.getItem("last-db-file") || "";
const initialPersisted = loadTabsForDb(initialDbPath);
const initialTabs: QueryTab[] = initialPersisted ? toQueryTabs(initialPersisted) : [defaultTab()];
const initialActiveId: string = initialPersisted ? initialPersisted.activeTabId : initialTabs[0].id;

const [tabsSignal, _setTabs] = createSignal<QueryTab[]>(initialTabs);
const [activeTabIdSignal, _setActiveTabId] = createSignal<string>(initialActiveId);

export const tabs = tabsSignal;
export const activeTabId = activeTabIdSignal;

let persistTimer: number | undefined;
let serverPersistTimer: number | undefined;
const buildServerPayload = () => {
    const current = tabsSignal();
    const active = activeTabIdSignal();
    return {
        tabs: current.slice(0, MAX_PERSISTED_TABS).map((t) => ({
            id: t.id,
            name: t.name,
            sql: (t.sql || "").slice(0, MAX_SQL_CHARS),
        })),
        activeTabId: current.some((t) => t.id === active) ? active : current[0]?.id || "",
    };
};
const writePersistNow = () => {
    try {
        const key = tabsKey(currentDbPath());
        const { tabs: payloadTabs, activeTabId: payloadActive } = buildServerPayload();
        if (!payloadActive) return;
        const payload: PersistedState = { v: 1, tabs: payloadTabs, activeTabId: payloadActive };
        localStorage.setItem(key, JSON.stringify(payload));
    } catch {
        // Quota or private-mode failures should never break the editor.
    }
};
const saveTabsToServerNow = async (dbPath?: string) => {
    try {
        const targetDb = dbPath ?? currentDbPath();
        const key = apiKey();
        if (!key || !targetDb) return;
        const { tabs: payloadTabs, activeTabId: payloadActive } = buildServerPayload();
        if (!payloadActive || payloadTabs.length === 0) return;
        // Don't push a pristine empty tab over real server state on boot;
        // server fetch first will populate, then edits push.
        await api.saveOpenTabs(targetDb, payloadTabs, payloadActive, key, onUnauthorized);
    } catch {
        // Offline / server errors must never break editing; localStorage remains source of truth.
    }
};
const schedulePersist = () => {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(writePersistNow, 250);
    window.clearTimeout(serverPersistTimer);
    serverPersistTimer = window.setTimeout(() => void saveTabsToServerNow(), 1000);
};
export const flushPersistedTabs = () => {
    const dbPath = currentDbPath();
    window.clearTimeout(persistTimer);
    window.clearTimeout(serverPersistTimer);
    writePersistNow();
    if (dbPath) void saveTabsToServerNow(dbPath);
};

if (typeof window !== "undefined") {
    window.addEventListener("pagehide", writePersistNow);
    window.addEventListener("beforeunload", writePersistNow);
}

export const setTabs: typeof _setTabs = ((...args: Parameters<typeof _setTabs>) => {
    ( _setTabs as (...a: unknown[]) => unknown)(...args);
    schedulePersist();
}) as typeof _setTabs;

export const setActiveTabId = (id: string) => {
    _setActiveTabId(id);
    schedulePersist();
};
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

export const restoreTabsForDb = (dbPath: string) => {
    const persisted = loadTabsForDb(dbPath);
    if (persisted) {
        _setTabs(toQueryTabs(persisted));
        _setActiveTabId(persisted.activeTabId);
    } else {
        const fresh = defaultTab();
        _setTabs([fresh]);
        _setActiveTabId(fresh.id);
    }
    // Reconcile with server in background so another computer's tabs restore here.
    // Server wins when it has real content; local unsaved content is preserved otherwise.
    void syncTabsFromServer(dbPath);
};

export const syncTabsFromServer = async (dbPath?: string): Promise<boolean> => {
    const targetDb = dbPath ?? currentDbPath();
    const key = apiKey();
    // Only sync the currently-visible DB to avoid applying stale responses after a switch.
    if (!key || !targetDb || targetDb !== currentDbPath()) return false;
    let server: api.OpenTabsState | null = null;
    try {
        server = await api.fetchOpenTabs(targetDb, key, onUnauthorized);
    } catch {
        return false;
    }
    if (!server || targetDb !== currentDbPath()) return false;
    const sanitized = sanitizePersisted({ tabs: server.tabs, activeTabId: server.active_tab_id });
    if (!sanitized) return false;
    const local = tabsSignal();
    const localHasContent = local.some((t) => t.sql.trim() !== "");
    const serverHasContent = sanitized.tabs.some((t) => t.sql.trim() !== "");
    const localIsPristine = local.length === 1 && !localHasContent;
    // Prefer server when: local is pristine, or server has content (last-write-wins for conflicts).
    // Keep local when it has unsaved content and server is empty/missing.
    if (!localIsPristine && !serverHasContent && localHasContent) return false;
    _setTabs(toQueryTabs(sanitized));
    _setActiveTabId(sanitized.activeTabId);
    writePersistNow();
    return true;
};

export const resetStore = () => {
    setTables([]);
    setCurrentTable(null);
    restoreTabsForDb(currentDbPath());
    setDatabaseSchema(null);
    setTableSchema(null);
    setSqliteInternals(null);
    setSelectedSchemaObject(null);
    setMetadataError(null);
};

export const logoutUser = async () => {
    flushPersistedTabs();
    await api.logout();
    localStorage.removeItem("api_key");
    setApiKey("");
    setTables([]);
    setCurrentTable(null);
    const fresh = defaultTab();
    _setTabs([fresh]);
    _setActiveTabId(fresh.id);
    setDatabaseSchema(null);
    setTableSchema(null);
    setSqliteInternals(null);
    setSelectedSchemaObject(null);
    setMetadataError(null);
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
    const oldDb = currentDbPath();
    if (oldDb && oldDb !== path) {
        writePersistNow();
        try {
            await saveTabsToServerNow(oldDb);
        } catch {
            // keep connecting even if tab sync fails
        }
    } else {
        flushPersistedTabs();
    }
    const result = await api.connectDb(path, create, apiKey(), onUnauthorized);
    if (!result.success) throw new Error(`Connect failed (status ${result.status})`);
    localStorage.setItem("last-db-file", path);
    setCurrentDbPath(path);
    setTables([]);
    setCurrentTable(null);
    setDatabaseSchema(null);
    setTableSchema(null);
    setSqliteInternals(null);
    setSelectedSchemaObject(null);
    setMetadataError(null);
    restoreTabsForDb(path);
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

export const [savedSort, setSavedSort] = createSignal<api.SavedQuerySort>("updated");
export const [savedAllTags, setSavedAllTags] = createSignal<string[]>([]);

export const allSavedTags = createMemo(() => {
    const tags = new Set<string>(savedAllTags());
    for (const q of savedQueries()) {
        for (const t of (q.tags || "").split(",").map((s) => s.trim()).filter(Boolean)) tags.add(t);
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
});

export const fetchSavedTags = async () => {
    const db = currentDbPath();
    if (!db) {
        setSavedAllTags([]);
        return;
    }
    try {
        const tags = await api.fetchSavedQueryTags(db, apiKey(), onUnauthorized);
        setSavedAllTags(tags);
    } catch {
        // Keep page-derived tags as fallback; don't toast on tags-only failure.
    }
};

export const fetchSavedQueries = async () => {
    const db = currentDbPath();
    if (!db) {
        setSavedQueries([]);
        return;
    }
    setIsLoadingSavedQueries(true);
    try {
        const queries = await api.fetchSavedQueries(db, apiKey(), { search: savedSearch(), tag: savedTag(), sort: savedSort() }, onUnauthorized);
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
        void fetchSavedTags();
        return updated;
    }
    const created = await api.createSavedQuery(db, name, sql, apiKey(), tags, onUnauthorized);
    setSavedQueries((prev) => [created, ...prev]);
    void fetchSavedTags();
    return created;
};

export const duplicateSavedQuery = async (id: number) => {
    const db = currentDbPath();
    if (!db) throw new Error("No database connected");
    const orig = savedQueries().find((q) => q.id === id);
    if (!orig) throw new Error("Saved query not found");
    const created = await api.createSavedQuery(db, `${orig.name} (copy)`, orig.query, apiKey(), orig.tags, onUnauthorized);
    setSavedQueries((prev) => [created, ...prev]);
    void fetchSavedTags();
    return created;
};

export const removeSavedQuery = async (id: number) => {
    await api.deleteSavedQuery(id, apiKey(), onUnauthorized);
    setSavedQueries((prev) => prev.filter((q) => q.id !== id));
    void fetchSavedTags();
};

export const updateActiveTab = (patch: Partial<QueryTab>) => {
    const id = activeTabId();
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
};

export const addTab = (sql = "") => {
    const existing = new Set(tabs().map((t) => t.name));
    let n = tabs().length + 1;
    while (existing.has(`Query ${n}`)) n++;
    const tab: QueryTab = { id: uid(), name: `Query ${n}`, sql, result: null, page: 1, pageSize: 100 };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
};

export const closeTab = (id: string) => {
    const prev = tabs();
    if (prev.length === 1) {
        setTabs([{ ...prev[0], result: null, page: 1 }]);
        return;
    }
    const next = prev.filter((t) => t.id !== id);
    if (next.length === prev.length) return;
    setTabs(next);
    if (id === activeTabId()) setActiveTabId(next[next.length - 1].id);
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
