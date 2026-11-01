
export interface QueryResult {
    columns: string[];
    columnTypes?: string[];
    rows: any[][];
    executionTime?: number;
    affectedRows?: number;
    error?: string;
}

export interface SchemaObject {
    object_type: "table" | "view" | "index" | "trigger";
    name: string;
    table_name: string;
    sql: string | null;
}

export interface DatabaseSchema {
    objects: SchemaObject[];
    ddl: string;
}

export interface ColumnSchema {
    cid: number;
    name: string;
    declared_type: string;
    not_null: boolean;
    default_value: string | null;
    primary_key_position: number;
    hidden: number;
}

export interface ForeignKeySchema {
    id: number;
    sequence: number;
    referenced_table: string;
    from: string;
    to: string | null;
    on_update: string;
    on_delete: string;
    match_type: string;
}

export interface IndexSchema {
    name: string;
    unique: boolean;
    origin: string;
    partial: boolean;
    columns: { name: string | null; descending: boolean; collation: string }[];
}

export interface TableSchema {
    name: string;
    sql: string | null;
    columns: ColumnSchema[];
    foreign_keys: ForeignKeySchema[];
    indexes: IndexSchema[];
    triggers: { name: string; sql: string | null }[];
}

export interface MetadataValue {
    name: string;
    values: string[];
}

export interface SqliteSchemaEntry {
    object_type: string;
    name: string;
    table_name: string;
    root_page: number;
    sql: string | null;
}

export interface SqliteInternals {
    database: MetadataValue[];
    connection: MetadataValue[];
    engine: MetadataValue[];
    schema_entries: SqliteSchemaEntry[];
}


export interface AuthConfig {
    turnstile_enabled: boolean;
    turnstile_site_key: string | null;
}

export const fetchAuthConfig = async (): Promise<AuthConfig> => {
    try {
        const res = await fetch("./api/auth/config", { credentials: "same-origin" });
        if (res.ok) {
            return await res.json();
        }
    } catch (e) {
        console.error("Failed to fetch auth config", e);
    }
    return { turnstile_enabled: false, turnstile_site_key: null };
};

export const login = async (
    apiKey: string,
    turnstileToken?: string,
): Promise<{ success: boolean; error?: string }> => {
    try {
        const res = await fetch("./api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
                api_key: apiKey,
                turnstile_token: turnstileToken || null,
            }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
            return { success: true };
        }
        return { success: false, error: data.error || "Authentication failed" };
    } catch (e: any) {
        return { success: false, error: e.message || "Network error" };
    }
};

export const logout = async (): Promise<void> => {
    try {
        await fetch("./api/auth/logout", {
            method: "POST",
            credentials: "same-origin",
        });
    } catch (e) {
        console.error("Logout request failed", e);
    }
};

const getHeaders = (apiKey: string) => ({
    "Content-Type": "application/json",
    ...(apiKey ? { "x-api-key": apiKey } : {}),
});

const handleResponse = async (res: Response, onUnauthorized?: () => void) => {
    if (res.status === 401) {
        if (onUnauthorized) onUnauthorized();
        throw new Error("Unauthorized");
    }
    return res;
};

export const fetchTables = async (apiKey: string, onUnauthorized?: () => void): Promise<string[]> => {
    const res = await fetch("./api/tables", {
        headers: getHeaders(apiKey),
        credentials: "same-origin",
    });
    await handleResponse(res, onUnauthorized);
    if (res.ok) {
        return await res.json();
    }
    throw new Error("Failed to fetch tables");
};

const fetchMetadata = async <T>(
    path: string,
    apiKey: string,
    onUnauthorized: (() => void) | undefined,
    errorMessage: string,
): Promise<T> => {
    const res = await fetch(path, {
        headers: getHeaders(apiKey),
        credentials: "same-origin",
    });
    await handleResponse(res, onUnauthorized);
    if (!res.ok) throw new Error(errorMessage);
    return await res.json() as T;
};

export const fetchDatabaseSchema = (apiKey: string, onUnauthorized?: () => void) =>
    fetchMetadata<DatabaseSchema>("./api/schema", apiKey, onUnauthorized, "Failed to fetch database schema");

export const fetchTableSchema = (name: string, apiKey: string, onUnauthorized?: () => void) =>
    fetchMetadata<TableSchema>(
        `./api/schema/table?${new URLSearchParams({ name })}`,
        apiKey,
        onUnauthorized,
        "Failed to fetch table schema",
    );

export const fetchSqliteInternals = (apiKey: string, onUnauthorized?: () => void) =>
    fetchMetadata<SqliteInternals>("./api/internals", apiKey, onUnauthorized, "Failed to fetch SQLite internals");

export const execSql = async (sql: string, apiKey: string, onUnauthorized?: () => void): Promise<QueryResult> => {
    const response = await fetch("./api/query", {
        method: "POST",
        headers: getHeaders(apiKey),
        credentials: "same-origin",
        body: JSON.stringify({ sql }),
    });

    await handleResponse(response, onUnauthorized);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Failed to execute query");
    }

    // Map backend response to QueryResult
    return {
        columns: data.columns || [],
        columnTypes: data.column_types || [],
        rows: data.rows || [],
        executionTime: data.execution_time,
        affectedRows: data.affected_rows,
        error: data.error
    };
};

export interface CorrectResult {
    sql?: string;
    error?: string;
}

export const correctSql = async (sql: string, table: string, apiKey: string, onUnauthorized?: () => void): Promise<CorrectResult> => {
    const response = await fetch("./api/correct", {
        method: "POST",
        headers: getHeaders(apiKey),
        credentials: "same-origin",
        body: JSON.stringify({ sql, table }),
    });

    await handleResponse(response, onUnauthorized);
    return await response.json();
};

export const getDbFiles = async (apiKey: string, onUnauthorized?: () => void): Promise<string[]> => {
    const res = await fetch("./api/db-files", {
        headers: getHeaders(apiKey),
        credentials: "same-origin",
    });
    await handleResponse(res, onUnauthorized);
    if (res.ok) {
        return await res.json();
    }
    throw new Error("Failed to fetch db files");
};

export interface HealthResult {
    status: string;
    version?: string;
}

export const getHealth = async (): Promise<HealthResult> => {
    const res = await fetch("./api/health", { credentials: "same-origin" });
    return await res.json();
};

export const connectDb = async (
    path: string,
    create: boolean,
    apiKey: string,
    onUnauthorized?: () => void
): Promise<{ success: boolean; status: number }> => {
    const res = await fetch("./api/connect", {
        method: "POST",
        headers: getHeaders(apiKey),
        credentials: "same-origin",
        body: JSON.stringify({ path, create }),
    });

    if (res.status === 401) {
        if (onUnauthorized) onUnauthorized();
        return { success: false, status: 401 };
    }
    return { success: res.ok, status: res.status };
};
