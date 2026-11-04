import { Component, For, Show } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import { currentDbPath, setPaletteOpen, apiKey, setIsAuthModalOpen, logoutUser } from "../lib/store";
import ThemeSwitch from "./ThemeSwitch";
import Icon from "./Icon";

const NAV = [
  { href: "/", label: "Query", icon: "terminal", match: (p: string) => p === "/" },
  { href: "/schema", label: "Schema", icon: "schema", match: (p: string) => p.startsWith("/schema") },
  { href: "/internals", label: "Internals", icon: "memory", match: (p: string) => p.startsWith("/internals") },
  { href: "/saved", label: "Saved", icon: "bookmark", match: (p: string) => p.startsWith("/saved") },
  { href: "/databases", label: "Databases", icon: "database", match: (p: string) => p.startsWith("/databases") },
];

const NavRail: Component = () => {
  const location = useLocation();
  return (
    <nav aria-label="Primary" class="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-3">
      <div class="mb-2 grid size-9 place-items-center rounded-lg bg-primary font-mono text-sm font-bold text-primary-foreground" aria-hidden="true">
        C
      </div>
      <For each={NAV}>
        {(item) => (
          <A href={item.href} class="nav-rail-btn w-14" data-active={item.match(location.pathname)} aria-current={item.match(location.pathname) ? "page" : undefined} title={item.label}>
            <Icon name={item.icon} class="size-5" />
            <span>{item.label}</span>
          </A>
        )}
      </For>
      <div class="mt-auto flex w-full flex-col items-center gap-1 px-1">
        <button type="button" class="nav-rail-btn" onClick={() => setPaletteOpen(true)} title="Command palette (Ctrl+K)" aria-label="Open command palette">
          <Icon name="search" class="size-5" />
          <span>Find</span>
        </button>
        <ThemeSwitch />
        <Show when={apiKey()}>
          <button type="button" class="nav-rail-btn" onClick={() => logoutUser()} title="Log out" aria-label="Log out">
            <Icon name="logout" class="size-5" />
            <span>Out</span>
          </button>
        </Show>
        <Show when={!apiKey()}>
          <button type="button" class="nav-rail-btn" onClick={() => setIsAuthModalOpen(true)} title="Log in" aria-label="Log in">
            <Icon name="key" class="size-5" />
            <span>In</span>
          </button>
        </Show>
      </div>
      <Show when={currentDbPath()}>
        <div class="mt-1 w-12 truncate px-1 text-center font-mono text-[10px] text-muted-foreground" title={currentDbPath()}>
          {currentDbPath().split("/").pop()}
        </div>
      </Show>
    </nav>
  );
};

export default NavRail;
