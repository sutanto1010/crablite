import { Component, createSignal, onMount, For, Show } from "solid-js";
import ThemeSwitch from "./ThemeSwitch";
import {
  fetchTables,
  resetStore,
  apiKey,
  setIsAuthModalOpen,
  logoutUser,
  currentDbPath,
  setCurrentDbPath,
  fetchSavedQueries,
} from "../lib/store";
import { getDbFiles, connectDb, getHealth } from "../lib/api";
import Icon from "./Icon";

const Navbar: Component = () => {
  const [appVersion, setAppVersion] = createSignal("");
  // DB Logic
  const [dbFiles, setDbFiles] = createSignal<string[]>([]);
  const [inputPath, setInputPath] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal("");
  const [showCreateDialog, setShowCreateDialog] = createSignal(false);

  onMount(async () => {
    // DB Auto-load Logic
    await fetchDbFiles();

    // fetch version from health endpoint
    const h = await getHealth();
    setAppVersion(h.version || "");
  });

  async function fetchDbFiles() {
    try {
      const files = await getDbFiles(apiKey(), () => {
        setIsAuthModalOpen(true);
        setDbFiles([]);
      });
      setDbFiles(files);
    } catch (e) {
      console.error("Failed to fetch db files", e);
      setDbFiles([]);
      return;
    }

    const files = dbFiles();
    if (files.length > 0) {
      const last = localStorage.getItem("last-db-file");
      if (last && files.includes(last)) {
        setCurrentDbPath(last);
      } else {
        setCurrentDbPath(files[0]);
      }
      await autoLoad();
    } else {
      setShowCreateDialog(true);
    }
  }

  function saveLastFile(path: string) {
    localStorage.setItem("last-db-file", path);
  }

  async function connectAPI(
    path: string,
    create: boolean = false,
  ): Promise<{ success: boolean; status: number }> {
    try {
      return await connectDb(path, create, apiKey(), () => setIsAuthModalOpen(true));
    } catch (e) {
      console.error("Connection failed", e);
      return { success: false, status: 500 };
    }
  }

  async function autoLoad() {
    const path = currentDbPath();
    if (!path) return;

    setIsLoading(true);
    const { success } = await connectAPI(path);
    setIsLoading(false);

    if (success) {
      saveLastFile(path);
      fetchTables();
      fetchSavedQueries(path);
    } else {
      setErrorMsg("Failed to connect to " + path);
    }
  }

  function onConnectSuccess(path: string) {
    saveLastFile(path);
    setCurrentDbPath(path);
    setInputPath("");
    setErrorMsg("");

    resetStore();

    const files = dbFiles();
    if (!files.includes(path)) {
      setDbFiles([path, ...files]);
    }

    fetchTables();
    fetchSavedQueries(path);
  }

  async function handleCreateConfirm() {
    const path = inputPath();
    if (!path) {
      setErrorMsg("Filename cannot be empty.");
      return;
    }

    if (path.includes("/") || path.includes("\\")) {
      setErrorMsg("Invalid filename. Only filenames are allowed.");
      return;
    }

    setIsLoading(true);
    const { success } = await connectAPI(path, true);
    setIsLoading(false);

    if (success) {
      setShowCreateDialog(false);
      onConnectSuccess(path);
    } else {
      setErrorMsg("Failed to create database.");
    }
  }

  async function handleSelectorChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    const path = target.value;
    if (!path) return;

    const previous = currentDbPath();
    setCurrentDbPath(path);

    setIsLoading(true);
    const { success } = await connectAPI(path);
    setIsLoading(false);

    if (success) {
      onConnectSuccess(path);
    } else {
      setCurrentDbPath(previous);
      setErrorMsg("Failed to switch to " + path);
    }
  }

  function openCreateDialog() {
    setInputPath("");
    setErrorMsg("");
    setShowCreateDialog(true);
  }

  return (
    <header class="navbar min-h-16 bg-base-100 border-b border-base-300 gap-4 px-3 sm:px-5 justify-between">
      <div class="navbar-start w-auto">
        <img src="./logo.png" alt="crablite" class="size-8 inline-block mr-2" />
        <h1 class="text-primary text-xl font-medium tracking-tight hidden sm:inline-block">
          crablite
          <Show when={appVersion()}>
            <span class="text-sm text-base-content/60 ml-2">v{appVersion()}</span>
          </Show>
        </h1>
      </div>
      <div class="navbar-center flex-1 max-w-128 flex flex-col">
        <div class="join w-full">
          <select
            class="select select-bordered w-full join-item bg-base-100"
            value={currentDbPath()}
            onChange={handleSelectorChange}
            disabled={isLoading()}
          >
            <Show when={dbFiles().length === 0}>
              <option disabled selected value="">
                No databases found
              </option>
            </Show>
            <For each={dbFiles()}>
              {(path) => <option value={path}>{path}</option>}
            </For>
          </select>
          <button
            class="btn btn-primary join-item btn-square"
            onClick={openCreateDialog}
            title="Create database"
            aria-label="Create database"
          >
            <Icon name="database" />
          </button>
        </div>

        {/* Create DB Confirmation Modal */}
        <dialog class="modal" classList={{ "modal-open": showCreateDialog() }}>
          <div class="modal-box">
            <div class="size-12 rounded-full bg-primary/12 text-primary grid place-items-center mb-4"><Icon name="database" /></div>
            <h3 class="font-medium text-xl">Create database</h3>
            <input
              type="text"
              placeholder="Database filename (e.g my.db)"
              class="input input-bordered w-full mt-4"
              aria-label="Database filename"
              value={inputPath()}
              onInput={(e) => setInputPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateConfirm()}
            />
            <div class="modal-action">
              <button class="btn" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </button>
              <button
                class="btn btn-primary"
                onClick={handleCreateConfirm}
                disabled={isLoading()}
              >
                <Show when={isLoading()}>
                  <span class="loading loading-spinner loading-xs"></span>
                </Show>
                Create
              </button>
            </div>
          </div>
        </dialog>
        <Show when={errorMsg() && !showCreateDialog()}>
          <div class="toast toast-top toast-center z-50">
            <button
              class="alert alert-error text-white shadow-lg cursor-pointer text-start"
              onClick={() => setErrorMsg("")}
            >
              <span>{errorMsg()}</span>
            </button>
          </div>
        </Show>
      </div>
      <div class="navbar-end w-auto flex items-center gap-1">
        <ThemeSwitch />
        <button
          class="btn btn-ghost btn-circle"
          onClick={logoutUser}
          title="Log out"
          aria-label="Log out"
        >
          <Icon name="logout" />
        </button>
      </div>
    </header>
  );
};

export default Navbar;
