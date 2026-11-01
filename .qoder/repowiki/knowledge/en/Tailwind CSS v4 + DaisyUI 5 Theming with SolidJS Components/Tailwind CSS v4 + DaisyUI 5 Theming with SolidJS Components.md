---
kind: frontend_style
name: Tailwind CSS v4 + DaisyUI 5 Theming with SolidJS Components
category: frontend_style
scope:
    - '**'
source_files:
    - frontend/src/app.css
    - frontend/vite.config.ts
    - frontend/package.json
    - frontend/src/components/ThemeSwitch.tsx
    - frontend/src/components/Navbar.tsx
    - frontend/src/components/Editor.tsx
    - frontend/src/components/ResultTable.tsx
    - frontend/src/components/AuthModal.tsx
---

## Approach

The frontend is styled with **Tailwind CSS v4** (via `@tailwindcss/vite`) and the **DaisyUI 5** component library, built on top of a **SolidJS** application served through **Vite**. There is no custom CSS framework beyond Tailwind/DaisyUI — styling lives entirely in inline `class` attributes on JSX elements.

## Key Files

- `frontend/src/app.css` — single stylesheet that imports Tailwind and registers two DaisyUI themes (`light`, `dark`) via `@plugin "daisyui/theme"`. All color tokens are declared as CSS custom properties using `oklch()` values (e.g. `--color-primary: oklch(0.58 0.19 28.56)`), plus shared radius/size/border/depth/noise variables.
- `frontend/vite.config.ts` — Vite config wiring `solidPlugin`, `tailwindcss` plugin, and `solid-devtools`; sets `base: './'` for static hosting and proxies `/api` to `http://localhost:3000` in dev.
- `frontend/package.json` — declares dependencies `tailwindcss ^4.3.0`, `@tailwindcss/vite ^4.3.0`, `daisyui ^5.5.20`, `solid-js ^1.9.12`, `vite-plugin-solid ^2.11.12`.
- `frontend/src/components/ThemeSwitch.tsx` — runtime theme toggle that writes `data-theme="light|dark"` onto `<html>` and persists the choice in `localStorage` under key `theme`.
- Component files under `frontend/src/components/*.tsx` (`Navbar.tsx`, `Editor.tsx`, `ResultTable.tsx`, `AuthModal.tsx`, `Sidebar.tsx`, `Toolbar.tsx`) — all use Tailwind utility classes and DaisyUI component classes directly in JSX `class` attributes.

## Architecture and Conventions

- **Single source of truth for design tokens**: `app.css` defines every semantic color (`--color-base-*`, `--color-primary`, `--color-secondary`, `--color-accent`, `--color-neutral`, `--color-info`, `--color-success`, `--color-warning`, `--color-error` and their `*-content` variants) as `oklch()` values. Both light and dark themes share identical hue/saturation/lightness values; only base/background luminance differs.
- **Two named DaisyUI themes**: `light` is marked `default: true` and `prefersdark: false`; `dark` is `default: false` and also `prefersdark: false`. The app does not rely on OS-level dark mode detection — it uses explicit `data-theme` toggling.
- **Runtime theme switching**: `ThemeSwitch.tsx` reads `localStorage.getItem("theme")` on mount, then calls `document.documentElement.setAttribute("data-theme", ...)` on toggle. This drives DaisyUI's theme system at runtime.
- **No CSS modules, no SCSS, no PostCSS plugins**: styling is purely Tailwind utilities + DaisyUI class names composed inline in JSX.
- **Responsive strategy**: Tailwind's responsive prefixes are used (e.g. `hidden sm:inline-block`, `sm:flex-row`, `sm:items-center`); no media queries are written manually.
- **Component composition pattern**: each UI concern is a SolidJS component file under `src/components/`, with styles co-located as Tailwind class strings rather than separate style files.

## Conventions and Constraints

- All visual styling goes through Tailwind utility classes and DaisyUI component classes applied via the `class` attribute on JSX elements (SolidJS convention, not `className`).
- Semantic colors are referenced by DaisyUI token names (e.g. `bg-base-100`, `text-primary`, `text-base-content/60`, `border-base-300`) rather than raw color literals — this is enforced by the fact that `app.css` overrides DaisyUI's default tokens with `oklch()` values.
- Theme persistence is implemented consistently in `ThemeSwitch.tsx`: the chosen theme is stored under the `theme` key in `localStorage` and reflected as `data-theme` on `<html>`.
- The build targets modern browsers: `vite.config.ts` sets `build.target = "esnext"`.
- No additional CSS tooling is configured beyond what `@tailwindcss/vite` provides — there is no `tailwind.config.js`, no PostCSS pipeline, and no custom CSS-in-JS.