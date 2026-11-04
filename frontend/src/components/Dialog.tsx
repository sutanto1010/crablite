import { Component, JSX, Show, createEffect, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import Icon from "./Icon";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: string;
  children: JSX.Element;
  footer?: JSX.Element;
  labelledBy?: string;
}

const Dialog: Component<DialogProps> = (props) => {
  let dialogRef: HTMLDivElement | undefined;
  let previouslyFocused: HTMLElement | null = null;

  createEffect(() => {
    if (props.open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      const focusable = dialogRef?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
      queueMicrotask(() => (focusable ?? dialogRef)?.focus());
      document.body.style.overflow = "hidden";
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
        if (e.key === "Tab" && dialogRef) {
          const items = [...dialogRef.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
            (el) => !el.hasAttribute("disabled"),
          );
          if (items.length === 0) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };
      document.addEventListener("keydown", onKey, true);
      onCleanup(() => {
        document.removeEventListener("keydown", onKey, true);
        document.body.style.overflow = "";
        previouslyFocused?.focus?.();
      });
    }
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) props.onClose();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={props.title}
            tabindex="-1"
            class="card w-full max-w-md p-6 shadow-xl outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="mb-4 flex items-center gap-3">
              <Show when={props.icon}>
                <div class="grid size-10 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
                  <Icon name={props.icon!} class="size-5" />
                </div>
              </Show>
              <h2 class="text-lg font-semibold tracking-tight">{props.title}</h2>
              <button type="button" class="btn btn-ghost btn-sm btn-icon ml-auto" onClick={props.onClose} aria-label="Close dialog">
                <Icon name="close" class="size-4" />
              </button>
            </div>
            <div>{props.children}</div>
            <Show when={props.footer}>
              <div class="mt-5 flex justify-end gap-2">{props.footer}</div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export default Dialog;
