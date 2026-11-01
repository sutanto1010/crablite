import { Component, createSignal, onMount, For, Show } from "solid-js";
import ThemeSwitch from "./ThemeSwitch";
import { fetchTables, resetStore, apiKey, setIsAuthModalOpen } from "../lib/store";
import { getDbFiles, connectDb, getHealth } from "../lib/api";

const Navbar: Component = () => {
  const [appVersion, setAppVersion] = createSignal("");
  // DB Logic
  const [dbFiles, setDbFiles] = createSignal<string[]>([]);
  const [currentPath, setCurrentPath] = createSignal("");
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
        setCurrentPath(last);
      } else {
        setCurrentPath(files[0]);
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
    const path = currentPath();
    if (!path) return;

    setIsLoading(true);
    const { success } = await connectAPI(path);
    setIsLoading(false);

    if (success) {
      saveLastFile(path);
      fetchTables();
    } else {
      setErrorMsg("Failed to connect to " + path);
    }
  }

  function onConnectSuccess(path: string) {
    saveLastFile(path);
    setCurrentPath(path);
    setInputPath("");
    setErrorMsg("");

    resetStore();

    const files = dbFiles();
    if (!files.includes(path)) {
      setDbFiles([path, ...files]);
    }

    fetchTables();
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
    setCurrentPath(path);

    if (!path) return;
    setIsLoading(true);
    const { success } = await connectAPI(path);
    setIsLoading(false);

    if (success) {
      onConnectSuccess(path);
    } else {
      setErrorMsg("Failed to switch to " + path);
    }
  }

  function openCreateDialog() {
    setInputPath("");
    setErrorMsg("");
    setShowCreateDialog(true);
  }

  return (
    <div class="navbar bg-base-100 shadow-lg gap-4 px-4 justify-between">
      <div class="navbar-start w-auto">
        <img src="./logo.png" alt="crablite" class="size-8 inline-block mr-2" />
        <h1 class="text-primary text-xl font-bold hidden sm:inline-block">
          crablite
          <Show when={appVersion()}>
            <span class="text-sm text-base-content/60 ml-2">v{appVersion()}</span>
          </Show>
        </h1>
      </div>
      <div class="navbar-center flex-1 max-w-128 flex flex-col">
        <div class="join w-full">
          <select
            class="select select-bordered w-full join-item"
            value={currentPath()}
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
            class="btn btn-primary join-item"
            onClick={openCreateDialog}
            title="Create"
          >
            <svg
              class="size-6"
              fill="currentColor"
              viewBox="0 0 1024 1024"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M456.032 428.064c247.264 0 419.744-62.656 419.744-139.936V204.192c0-77.248-172.448-139.936-419.744-139.936S64.288 126.912 64.288 204.192v83.936c0 77.248 144.448 139.936 391.744 139.936z m-50.784 334.784c-169.824-6.304-268.992-45.056-321.152-96.928-13.312 13.248-19.808 27.36-19.808 41.984v111.936c0 77.248 144.448 139.872 391.744 139.872 24.736 0 48.832-0.768 72.512-2.016a307.2 307.2 0 0 1-123.296-194.848z m-5.12-56.224a306.304 306.304 0 0 1 70.4-194.72c-5.312 0.032-10.432 0.096-15.904 0.096-200.448 0-313.504-41.152-370.528-97.952-13.312 13.28-19.808 27.36-19.808 41.984v111.936c0 71.168 122.976 129.888 335.84 138.656z m307.744-250.56a251.84 251.84 0 1 0 0 503.68 251.84 251.84 0 0 0 0-503.68z m157.44 275.52h-133.76v133.728H684.16v-133.728h-133.728v-47.392h133.728v-133.76h47.424v133.76h133.76v47.392z"></path>
            </svg>
          </button>
        </div>

        {/* Create DB Confirmation Modal */}
        <dialog class="modal" classList={{ "modal-open": showCreateDialog() }}>
          <div class="modal-box">
            <h3 class="font-bold text-lg">Create New Database</h3>
            <input
              type="text"
              placeholder="Database filename (e.g my.db)"
              class="input input-bordered w-full mt-4"
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
      <div class="navbar-end w-auto">
        <ThemeSwitch />
      </div>
    </div>
  );
};

export default Navbar;
