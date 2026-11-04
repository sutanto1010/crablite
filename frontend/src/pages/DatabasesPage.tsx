import { Component, For, Show, createSignal, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as api from "../lib/api";
import Icon from "../components/Icon";
import Dialog from "../components/Dialog";
import {
  apiKey,
  dbFiles,
  isLoadingDbFiles,
  fetchDbFiles,
  currentDbPath,
  connectDatabase,
  pushToast,
} from "../lib/store";

const formatSize = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const DatabasesPage: Component = () => {
  const navigate = useNavigate();
  const [filter, setFilter] = createSignal("");
  const [newName, setNewName] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [uploading, setUploading] = createSignal(false);
  const [busy, setBusy] = createSignal<string | null>(null);

  onMount(() => {
    fetchDbFiles();
  });

  const files = () => {
    const q = filter().trim().toLowerCase();
    return dbFiles().filter((f) => !q || f.path.toLowerCase().includes(q));
  };

  const connect = async (path: string) => {
    setBusy(path);
    try {
      await connectDatabase(path, false);
      pushToast("success", `Connected to ${path}`);
      navigate("/");
    } catch (e: any) {
      pushToast("error", e?.message || "Connect failed");
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    const name = newName().trim();
    if (!name) return;
    const path = name.endsWith(".db") ? name : `${name}.db`;
    setCreating(true);
    try {
      await connectDatabase(path, true);
      setNewName("");
      await fetchDbFiles();
      pushToast("success", `Created ${path}`);
      navigate("/");
    } catch (e: any) {
      pushToast("error", e?.message || "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (path: string) => {
    if (!window.confirm(`Delete database file "${path}"? This cannot be undone.`)) return;
    setBusy(path);
    try {
      await api.deleteDbFile(path, apiKey());
      await fetchDbFiles();
      pushToast("success", `Deleted ${path}`);
    } catch (e: any) {
      pushToast("error", e?.message || "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  const commitRename = async (from: string) => {
    const to = renameValue().trim();
    if (!to || to === from) {
      setRenaming(null);
      return;
    }
    setBusy(from);
    try {
      await api.renameDbFile(from, to.endsWith(".db") ? to : `${to}.db`, apiKey());
      setRenaming(null);
      await fetchDbFiles();
      pushToast("success", `Renamed to ${to}`);
    } catch (e: any) {
      pushToast("error", e?.message || "Rename failed");
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const fallback = file.name.endsWith(".db") ? file.name : `${file.name}.db`;
    const path = window.prompt("Upload as path (relative .db path):", fallback);
    if (!path) return;
    setUploading(true);
    try {
      const data = await file.arrayBuffer();
      await api.uploadDbFile(path.trim(), data, apiKey());
      await fetchDbFiles();
      pushToast("success", `Uploaded ${path.trim()}`);
    } catch (e: any) {
      pushToast("error", e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
      <div class="flex flex-wrap items-center gap-2">
        <div>
          <h1 class="text-lg font-semibold tracking-tight">Databases</h1>
          <p class="text-sm text-muted-foreground">Manage .db files in the server directory. Connect, create, upload, rename, or delete.</p>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <input class="input h-9 w-48" placeholder="Filter files…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} aria-label="Filter database files" />
          <button type="button" class="btn btn-ghost btn-sm btn-icon" onClick={() => fetchDbFiles()} title="Refresh" aria-label="Refresh database files">
            <Icon name="refresh" class="size-4" />
          </button>
        </div>
      </div>

      <div class="card flex flex-wrap items-center gap-2 p-3">
        <input
          class="input h-9 min-w-48 flex-1 font-mono"
          placeholder="new-database.db"
          value={newName()}
          onInput={(e) => setNewName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          aria-label="New database name"
        />
        <button type="button" class="btn btn-default btn-sm" onClick={create} disabled={creating() || !newName().trim()}>
          <Icon name="add" class="size-4" /> {creating() ? "Creating…" : "Create & connect"}
        </button>
        <label class="btn btn-outline btn-sm cursor-pointer">
          <Icon name="upload" class="size-4" /> {uploading() ? "Uploading…" : "Upload .db"}
          <input type="file" accept=".db,application/octet-stream" class="sr-only" onChange={(e) => upload(e.currentTarget.files?.[0])} disabled={uploading()} />
        </label>
      </div>

      <Show when={isLoadingDbFiles()}>
        <div class="grid flex-1 place-items-center text-muted-foreground" role="status">
          <p>Loading database files…</p>
        </div>
      </Show>

      <Show when={!isLoadingDbFiles() && files().length === 0}>
        <div class="grid flex-1 place-items-center rounded-md border border-dashed border-border p-8 text-center">
          <div>
            <Icon name="database" class="mx-auto mb-2 size-8 text-muted-foreground" />
            <p class="text-sm font-medium">No database files found</p>
            <p class="mt-1 text-xs text-muted-foreground">Create one above or upload an existing .db file.</p>
          </div>
        </div>
      </Show>

      <Show when={!isLoadingDbFiles() && files().length > 0}>
        <div class="overflow-auto rounded-lg border border-border">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Path</th>
                <th scope="col">Size</th>
                <th scope="col">Modified</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <For each={files()}>
                {(file) => (
                  <tr data-selected={currentDbPath() === file.path}>
                    <td>
                      <div class="flex items-center gap-2 font-mono">
                        <Icon name="database" class="size-4 shrink-0 text-primary" />
                        <span class="truncate" title={file.path}>{file.path}</span>
                        <Show when={currentDbPath() === file.path}>
                          <span class="badge badge-primary">connected</span>
                        </Show>
                      </div>
                    </td>
                    <td class="font-mono">{formatSize(file.size_bytes)}</td>
                    <td class="font-mono">{file.modified_at ? new Date(Number(file.modified_at) * 1000).toLocaleString() : "—"}</td>
                    <td>
                      <div class="flex items-center justify-end gap-1">
                        <button type="button" class="btn btn-default btn-sm" onClick={() => connect(file.path)} disabled={busy() === file.path}>
                          Connect
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm" onClick={() => { setRenaming(file.path); setRenameValue(file.path); }}>
                          Rename
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm text-destructive" onClick={() => remove(file.path)} disabled={busy() === file.path} aria-label={`Delete ${file.path}`}>
                          <Icon name="delete" class="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      <Dialog
        open={renaming() !== null}
        onClose={() => setRenaming(null)}
        title="Rename database file"
        icon="edit"
        footer={
          <>
            <button type="button" class="btn btn-ghost" onClick={() => setRenaming(null)}>Cancel</button>
            <button type="button" class="btn btn-default" onClick={() => renaming() && commitRename(renaming()!)}>Rename</button>
          </>
        }
      >
        <label class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground" for="rename-path">
          New path
        </label>
        <input id="rename-path" class="input input-mono w-full" value={renameValue()} onInput={(e) => setRenameValue(e.currentTarget.value)} placeholder="renamed.db" />
      </Dialog>
    </div>
  );
};

export default DatabasesPage;
