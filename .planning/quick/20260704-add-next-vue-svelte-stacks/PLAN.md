---
slug: add-next-vue-svelte-stacks
created: 2026-07-04
type: quick
---

# Quick Task: Add Next.js, Vue 3, and Svelte 5 benchmark stacks

Add three stacks following the Angular pattern (`stacks/<name>.yaml` + `stacks/<name>/template/`):

- **next** — Next.js 16.2.10, App Router, `output: "export"` (static export moved to `dist/`), Tailwind v4.3 via `@tailwindcss/postcss`
- **vue** — Vue 3.5.39, Vite 8, Tailwind v4.3 via `@tailwindcss/vite`
- **svelte** — Svelte 5.56.4, Vite 8 (plain SPA, not SvelteKit), Tailwind v4.3 via `@tailwindcss/vite`

All serve the built `dist/` with `sirv --single --port 4200` (same model as Angular). Each template's main CSS embeds the scenario reference theme (`@theme` block from `scenarios/_shared/theme.tailwind.css`); the Angular template is retrofitted with the same block for cross-stack comparability (user decision). README gains a stack matrix.

Full approved plan: ~/.claude/plans/add-three-new-technology-mutable-moonbeam.md

## Decisions

- Theme tokens embedded in ALL four stacks (benchmark fairness) — user-confirmed
- Next.js uses static export + sirv, not `next start` SSR — user-confirmed
- New stacks omit `lint`/`test` yaml fields (optional, non-fatal pipeline stages)
- Vue/Svelte build is `vite build` only (no vue-tsc/svelte-check type gate)
