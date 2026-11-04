import { Component, For, Show } from "solid-js";
import { toasts, dismissToast } from "../lib/store";
import Icon from "./Icon";

const Toasts: Component = () => {
  return (
    <div class="pointer-events-none fixed bottom-12 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite" aria-atomic="false">
      <For each={toasts()}>
        {(toast) => (
          <div
            role={toast.kind === "error" ? "alert" : "status"}
            class={`card pointer-events-auto flex items-start gap-2.5 p-3 text-sm shadow-lg ${toast.kind === "error" ? "border-destructive/40" : ""}`}
          >
            <Icon
              name={toast.kind === "error" ? "error" : toast.kind === "success" ? "check" : "bolt"}
              class={`size-4 shrink-0 mt-0.5 ${toast.kind === "error" ? "text-destructive" : toast.kind === "success" ? "text-success" : "text-primary"}`}
            />
            <p class="min-w-0 flex-1 break-words">{toast.message}</p>
            <button type="button" class="btn btn-ghost btn-sm btn-icon shrink-0" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification">
              <Icon name="close" class="size-3.5" />
            </button>
          </div>
        )}
      </For>
      <Show when={toasts().length === 0}>
        <span class="sr-only">No notifications</span>
      </Show>
    </div>
  );
};

export default Toasts;
