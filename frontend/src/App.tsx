import { Component, Show } from "solid-js";
import Editor from "./components/Editor";
import Navbar from "./components/Navbar";
import ResultTable from "./components/ResultTable";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import AuthModal from "./components/AuthModal";
import SchemaExplorer from "./components/SchemaExplorer";
import WorkspaceTabs from "./components/WorkspaceTabs";
import { workspaceView } from "./lib/store";

const App: Component = () => {
  return (
    <div class="h-dvh bg-base-200 flex flex-col">
      <AuthModal />
      <Navbar />

      <div class="flex-1 flex flex-col md:flex-row gap-3 p-3 sm:p-4 min-h-0">
        <Sidebar />
        <main class="flex-1 min-w-0 min-h-0 flex flex-col px-3 sm:px-5 pt-3 pb-4 gap-3 h-full rounded-2xl bg-base-100 border border-base-300">
          <Editor />
          <WorkspaceTabs />
          <Show when={workspaceView() === "query"} fallback={<SchemaExplorer />}>
            <Toolbar />
            <ResultTable />
          </Show>
        </main>
      </div>
    </div>
  );
};

export default App;
