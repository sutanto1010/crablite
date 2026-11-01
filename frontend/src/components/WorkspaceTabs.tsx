import { Component, For } from "solid-js";
import Icon from "./Icon";
import {
  openDatabaseSchema,
  openSqliteInternals,
  setWorkspaceView,
  workspaceView,
  type WorkspaceView,
} from "../lib/store";

const tabs: { id: WorkspaceView; label: string; icon: string; action: () => void }[] = [
  { id: "query", label: "Query", icon: "terminal", action: () => setWorkspaceView("query") },
  { id: "schema", label: "Database Schema", icon: "account_tree", action: () => void openDatabaseSchema() },
  { id: "internals", label: "SQLite Internals", icon: "settings_ethernet", action: () => void openSqliteInternals() },
];

const WorkspaceTabs: Component = () => (
  <div class="flex gap-1 overflow-x-auto border-b border-base-300" role="tablist" aria-label="Workspace">
    <For each={tabs}>
      {(tab) => (
        <button
          role="tab"
          aria-selected={workspaceView() === tab.id}
          class={`workspace-tab ${workspaceView() === tab.id ? "workspace-tab-active" : ""}`}
          onClick={tab.action}
        >
          <Icon name={tab.icon} class="size-4.5" />
          <span class="whitespace-nowrap">{tab.label}</span>
        </button>
      )}
    </For>
  </div>
);

export default WorkspaceTabs;
