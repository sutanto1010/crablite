import { Component, createSignal, onMount } from "solid-js";
import Icon from "./Icon";

const ThemeSwitch: Component = () => {
  const [isDark, setIsDark] = createSignal(false);

  onMount(() => {
    const theme = localStorage.getItem("theme");
    const dark = theme === "dark";
    setIsDark(dark);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  });

  const toggleTheme = () => {
    const nextIsDark = !isDark();
    setIsDark(nextIsDark);
    const theme = nextIsDark ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  };

  return (
    <button
      class="btn btn-ghost btn-circle"
      onClick={toggleTheme}
      title={isDark() ? "Use light theme" : "Use dark theme"}
      aria-label={isDark() ? "Use light theme" : "Use dark theme"}
    >
      <Icon name={isDark() ? "light_mode" : "dark_mode"} />
    </button>
  );
};

export default ThemeSwitch;
