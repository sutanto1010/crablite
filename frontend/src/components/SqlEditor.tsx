import { Component, onMount, onCleanup, createEffect } from "solid-js";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { theme } from "../lib/store";

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onSave: () => void;
  tables?: string[];
}

const SqlEditor: Component<SqlEditorProps> = (props) => {
  let container: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  let suppress = false;

  onMount(() => {
    const runAndSave = [
      { key: "Mod-Enter", run: () => (props.onRun(), true) },
      { key: "Mod-s", run: () => (props.onSave(), true) },
    ];
    const themeCompartment = new Compartment();
    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      keymap.of([...runAndSave, ...defaultKeymap, ...historyKeymap]),
      sql({ upperCaseKeywords: true }),
      EditorView.lineWrapping,
      themeCompartment.of(theme() === "dark" ? oneDark : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !suppress) props.onChange(update.state.doc.toString());
      }),
    ];

    const state = EditorState.create({ doc: props.value, extensions });
    view = new EditorView({ state, parent: container! });
    (container as any).__themeCompartment = themeCompartment;
  });

  createEffect(() => {
    const dark = theme() === "dark";
    const compartment: Compartment | undefined = (container as any)?.__themeCompartment;
    if (!view || !compartment) return;
    view.dispatch({ effects: compartment.reconfigure(dark ? oneDark : []) });
  });

  createEffect(() => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== props.value) {
      suppress = true;
      view.dispatch({ changes: { from: 0, to: current.length, insert: props.value } });
      suppress = false;
    }
  });

  onCleanup(() => view?.destroy());

  return (
    <div class="editor-shell overflow-hidden rounded-md border border-input bg-card focus-within:border-ring focus-within:ring-1 focus-within:ring-ring" role="textbox" aria-label="SQL editor. Press Control Enter to run." aria-multiline="true">
      <div ref={container} />
    </div>
  );
};

export default SqlEditor;
