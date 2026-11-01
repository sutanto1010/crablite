import { Component, createEffect, Show } from "solid-js";
import {
  correctSql,
  isCorrecting,
  setSqlContent,
  setShouldFocusSqlInput,
  shouldFocusSqlInput,
  sqlContent,
} from "../lib/store";
import Icon from "./Icon";

const Editor: Component = () => {
  let textareaRef: HTMLTextAreaElement | undefined;

  createEffect(() => {
    if (shouldFocusSqlInput() && textareaRef) {
      textareaRef.focus();
      setShouldFocusSqlInput(false);
    }
  });

  return (
    <section aria-label="SQL Editor">
      <div class="flex items-center gap-2 mb-2 text-base-content/70">
        <Icon name="code" class="size-4.5" />
        <h2 class="text-sm font-medium">SQL Editor</h2>
      </div>
      <div class="relative">
        <textarea
          ref={textareaRef}
          class="textarea textarea-bordered w-full font-mono text-sm leading-6 h-24 bg-base-200/45"
          placeholder="SELECT * FROM sqlite_master"
          value={sqlContent()}
          onInput={(e) => setSqlContent(e.currentTarget.value)}
        ></textarea>
        <Show when={sqlContent().trim()}>
          <button
            class="btn btn-xs btn-outline bg-base-100 absolute bottom-2 right-2"
            onClick={correctSql}
            disabled={isCorrecting()}
          >
            <Show when={isCorrecting()} fallback={<span class="flex items-center gap-1"><Icon name="smart_toy" class="size-4" /> AI Fix</span>}>
              <span class="loading loading-spinner loading-sm"></span>
            </Show>
          </button>
        </Show>
      </div>
    </section>
  );
};

export default Editor;
