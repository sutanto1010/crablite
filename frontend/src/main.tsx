/* @refresh reload */
import { render } from "solid-js/web";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "./app.css";
import App from "./App";
import { applyTheme, theme } from "./lib/store";

const root = document.getElementById("app");

applyTheme((localStorage.getItem("theme") as "light" | "dark" | null) || theme());

if (root instanceof HTMLElement) {
  render(() => <App />, root);
}
