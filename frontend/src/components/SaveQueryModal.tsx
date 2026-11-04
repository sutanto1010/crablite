import { Component, Show, createSignal, createEffect } from "solid-js";
import { isSaveModalOpen, setIsSaveModalOpen, activeTab, saveQuery, pushToast } from "../lib/store";
import Dialog from "./Dialog";

const SaveQueryModal: Component = () => {
  const [name, setName] = createSignal("");
  const [tags, setTags] = createSignal("");
  const [isSaving, setIsSaving] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal("");

  createEffect(() => {
    if (isSaveModalOpen()) {
      setErrorMsg("");
      setName("");
      setTags("");
    }
  });

  const handleSave = async (e: Event) => {
    e.preventDefault();
    const queryName = name().trim();
    if (!queryName) {
      setErrorMsg("Please enter a name for the query.");
      return;
    }
    const sql = activeTab().sql.trim();
    if (!sql) {
      setErrorMsg("Query SQL cannot be empty.");
      return;
    }
    setIsSaving(true);
    setErrorMsg("");
    try {
      await saveQuery(queryName, sql, tags().trim());
      setIsSaveModalOpen(false);
      pushToast("success", `Saved "${queryName}"`);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save query");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={isSaveModalOpen()}
      onClose={() => !isSaving() && setIsSaveModalOpen(false)}
      title="Save Query"
      icon="bookmark"
      footer={
        <>
          <button type="button" class="btn btn-ghost" onClick={() => setIsSaveModalOpen(false)} disabled={isSaving()}>
            Cancel
          </button>
          <button type="submit" form="save-query-form" class="btn btn-default" disabled={isSaving() || !name().trim() || !activeTab().sql.trim()}>
            {isSaving() ? "Saving…" : "Save Query"}
          </button>
        </>
      }
    >
      <form id="save-query-form" onSubmit={handleSave} class="space-y-4">
        <div>
          <label class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground" for="save-query-name">
            Query Name
          </label>
          <input id="save-query-name" type="text" class="input w-full" placeholder="e.g. Active Users Count" value={name()} onInput={(e) => setName(e.currentTarget.value)} autofocus />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground" for="save-query-tags">
            Tags (comma separated)
          </label>
          <input id="save-query-tags" type="text" class="input input-mono w-full" placeholder="reports, users" value={tags()} onInput={(e) => setTags(e.currentTarget.value)} />
        </div>
        <div>
          <span class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">SQL Preview</span>
          <div class="max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2.5 font-mono text-xs text-muted-foreground">
            {activeTab().sql || "-- (empty query)"}
          </div>
        </div>
        <Show when={errorMsg()}>
          <div class="alert alert-error text-xs" role="alert">
            <span>{errorMsg()}</span>
          </div>
        </Show>
      </form>
    </Dialog>
  );
};

export default SaveQueryModal;
