import { Component, onMount, onCleanup, Show } from "solid-js";
import { Router, Route } from "@solidjs/router";
import NavRail from "./components/NavRail";
import ExplorerSidebar from "./components/ExplorerSidebar";
import StatusBar from "./components/StatusBar";
import Toasts from "./components/Toasts";
import AuthModal from "./components/AuthModal";
import SaveQueryModal from "./components/SaveQueryModal";
import CommandPalette from "./components/CommandPalette";
import QueryPage from "./pages/QueryPage";
import SchemaPage from "./pages/SchemaPage";
import InternalsPage from "./pages/InternalsPage";
import SavedPage from "./pages/SavedPage";
import DatabasesPage from "./pages/DatabasesPage";
import {
  apiKey,
  setIsAuthModalOpen,
  setPaletteOpen,
  fetchTables,
  fetchSavedQueries,
  fetchDbFiles,
  refreshHealth,
  runQuery,
  setIsSaveModalOpen,
  syncTabsFromServer,
} from "./lib/store";

const Shell: Component = (props: any) => {
  onMount(() => {
    refreshHealth();
    const timer = window.setInterval(refreshHealth, 30000);
    if (!apiKey()) {
      setIsAuthModalOpen(true);
    } else {
      fetchTables();
      fetchSavedQueries();
      fetchDbFiles();
      void syncTabsFromServer();
    }

    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && e.key === "Enter") {
        e.preventDefault();
        runQuery();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setIsSaveModalOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      window.clearInterval(timer);
      document.removeEventListener("keydown", onKey);
    });
  });

  return (
    <div class="flex h-dvh bg-background text-foreground">
      <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[80] focus:rounded focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      <AuthModal />
      <SaveQueryModal />
      <CommandPalette />
      <Toasts />
      <NavRail />
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex min-h-0 flex-1">
          <ExplorerSidebar />
          <main id="main" class="flex min-w-0 flex-1 flex-col bg-background" tabindex="-1">
            {props.children}
          </main>
        </div>
        <StatusBar />
      </div>
      <Show when={!apiKey()}>
        <span class="sr-only" role="status">
          Authentication required
        </span>
      </Show>
    </div>
  );
};

const App: Component = () => {
  return (
    <Router root={Shell}>
      <Route path="/" component={QueryPage} />
      <Route path="/schema" component={SchemaPage} />
      <Route path="/internals" component={InternalsPage} />
      <Route path="/saved" component={SavedPage} />
      <Route path="/databases" component={DatabasesPage} />
    </Router>
  );
};

export default App;
