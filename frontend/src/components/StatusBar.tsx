import { Component, Show } from "solid-js";
import { A } from "@solidjs/router";
import { health, lastExecutionMs, currentDbPath, isQuerying } from "../lib/store";
import Icon from "./Icon";

const StatusBar: Component = () => {
  return (
    <footer class="flex h-8 shrink-0 items-center gap-4 border-t border-border bg-card px-3 text-xs text-muted-foreground" aria-label="Status bar">
      <span class="flex min-w-0 items-center gap-1.5">
        <Icon name="database" class="size-3.5 shrink-0" />
        <span class="truncate font-mono" title={currentDbPath() || "No database connected"}>
          {currentDbPath() || "No database"}
        </span>
      </span>
      <span class="hidden items-center gap-1.5 sm:flex" role="status">
        <span class={`size-2 rounded-full ${health()?.status === "ok" ? "bg-success" : "bg-destructive"}`} aria-hidden="true" />
        {health()?.status === "ok" ? `healthy${health()?.version ? ` · v${health()?.version}` : ""}` : "unreachable"}
      </span>
      <span class="ml-auto flex items-center gap-1.5 font-mono" aria-live="polite">
        <Show when={isQuerying()} fallback={
          <>
            <Icon name="bolt" class="size-3.5" />
            {lastExecutionMs() != null ? `${lastExecutionMs()!.toFixed(1)} ms last run` : "idle"}
          </>
        }>
          running…
        </Show>
      </span>
      <A href="/internals" class="hidden items-center gap-1 hover:text-foreground md:flex">
        <Icon name="memory" class="size-3.5" />
        internals
      </A>
    </footer>
  );
};

export default StatusBar;
