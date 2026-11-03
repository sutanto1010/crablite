import { Component, createSignal, createEffect, Show } from "solid-js";
import {
  isSaveModalOpen,
  setIsSaveModalOpen,
  savedQueries,
  activeSavedQueryId,
  sqlContent,
  saveQuery,
} from "../lib/store";
import Icon from "./Icon";

const SaveQueryModal: Component = () => {
  const [name, setName] = createSignal("");
  const [mode, setMode] = createSignal<"update" | "new">("new");
  const [isSaving, setIsSaving] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal("");

  createEffect(() => {
    if (isSaveModalOpen()) {
      setErrorMsg("");
      const activeId = activeSavedQueryId();
      const currentSaved = activeId ? savedQueries().find((q) => q.id === activeId) : null;
      if (currentSaved) {
        setMode("update");
        setName(currentSaved.name);
      } else {
        setMode("new");
        setName("");
      }
    }
  });

  const activeQuery = () => {
    const id = activeSavedQueryId();
    return id ? savedQueries().find((q) => q.id === id) : null;
  };

  const handleSave = async (e: Event) => {
    e.preventDefault();
    const queryName = name().trim();
    if (!queryName) {
      setErrorMsg("Please enter a name for the query.");
      return;
    }
    const sql = sqlContent().trim();
    if (!sql) {
      setErrorMsg("Query SQL cannot be empty.");
      return;
    }

    setIsSaving(true);
    setErrorMsg("");
    try {
      if (mode() === "update" && activeSavedQueryId()) {
        await saveQuery(queryName, sql, activeSavedQueryId()!);
      } else {
        await saveQuery(queryName, sql);
      }
      setIsSaveModalOpen(false);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save query");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <dialog class="modal" classList={{ "modal-open": isSaveModalOpen() }}>
      <div class="modal-box max-w-md">
        <div class="flex items-center gap-3 mb-4">
          <div class="size-10 rounded-full bg-primary/12 text-primary grid place-items-center">
            <Icon name="bookmark" class="size-5" />
          </div>
          <h3 class="font-medium text-lg">Save Query</h3>
        </div>

        <form onSubmit={handleSave}>
          <Show when={activeQuery()}>
            {(active) => (
              <div class="form-control mb-4">
                <label class="label">
                  <span class="label-text font-medium text-xs uppercase tracking-wider text-base-content/60">
                    Save Action
                  </span>
                </label>
                <div class="flex gap-2">
                  <button
                    type="button"
                    class={`btn btn-sm flex-1 ${mode() === "update" ? "btn-primary" : "btn-outline"}`}
                    onClick={() => {
                      setMode("update");
                      setName(active().name);
                    }}
                  >
                    Update "{active().name}"
                  </button>
                  <button
                    type="button"
                    class={`btn btn-sm flex-1 ${mode() === "new" ? "btn-primary" : "btn-outline"}`}
                    onClick={() => {
                      setMode("new");
                      setName("");
                    }}
                  >
                    Save as new
                  </button>
                </div>
              </div>
            )}
          </Show>

          <div class="form-control mb-4">
            <label class="label">
              <span class="label-text font-medium text-xs uppercase tracking-wider text-base-content/60">
                Query Name
              </span>
            </label>
            <input
              type="text"
              class="input input-bordered w-full"
              placeholder="e.g. Active Users Count"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              autofocus
            />
          </div>

          <div class="form-control mb-4">
            <label class="label">
              <span class="label-text font-medium text-xs uppercase tracking-wider text-base-content/60">
                SQL Preview
              </span>
            </label>
            <div class="p-2.5 rounded-lg bg-base-200 text-xs font-mono max-h-28 overflow-y-auto whitespace-pre-wrap break-all text-base-content/80">
              {sqlContent() || "-- (empty query)"}
            </div>
          </div>

          <Show when={errorMsg()}>
            <div class="alert alert-error text-xs py-2 mb-4">
              <span>{errorMsg()}</span>
            </div>
          </Show>

          <div class="modal-action">
            <button
              type="button"
              class="btn btn-ghost"
              onClick={() => setIsSaveModalOpen(false)}
              disabled={isSaving()}
            >
              Cancel
            </button>
            <button
              type="submit"
              class="btn btn-primary"
              disabled={isSaving() || !name().trim() || !sqlContent().trim()}
            >
              <Show when={isSaving()} fallback={<span>{mode() === "update" ? "Update Query" : "Save Query"}</span>}>
                <span class="loading loading-spinner loading-xs"></span>
              </Show>
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
};

export default SaveQueryModal;

