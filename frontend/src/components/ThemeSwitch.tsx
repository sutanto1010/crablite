import { Component } from "solid-js";
import { theme, applyTheme } from "../lib/store";
import Icon from "./Icon";

const ThemeSwitch: Component = () => {
  const toggleTheme = () => applyTheme(theme() === "dark" ? "light" : "dark");
  const isDark = () => theme() === "dark";

  return (
    <button
      type="button"
      class="btn btn-ghost btn-sm btn-icon"
      onClick={toggleTheme}
      title={isDark() ? "Use light theme" : "Use dark theme"}
      aria-label={isDark() ? "Use light theme" : "Use dark theme"}
    >
      <Icon name={isDark() ? "light_mode" : "dark_mode"} class="size-4" />
    </button>
  );
};

export default ThemeSwitch;
