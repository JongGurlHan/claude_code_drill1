# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file browser MVP: **랜덤 식단 룰렛** (Random Meal Roulette) — a spinning
wheel that picks a lunch menu. Everything lives in `index.html` (inline `<style>`
and `<script>`, no external libraries, no build step). The rest of the tree is
Claude Code tooling under `.claude/`.

## Running & developing

- **Run it:** open `index.html` in a browser — `start index.html` (Windows) or
  double-click. There is no dev server, bundler, or install step.
- **No build / lint / test tooling exists yet** (no `package.json`). Don't assume
  `npm run …` works. If you add tooling, define `lint` / `build` / `test` scripts
  in `package.json` — the pre-commit hook (below) picks them up automatically.
- **Syntax-check the inline JS** (closest thing to a lint here), extract the
  `<script>` block and run `node --check` on it — see the pattern already used in
  session history. `node` is available on this machine.
- **Not a git repo yet.** `git init` before expecting the pre-commit hook to fire
  on real commits.

## Architecture of `index.html`

State-driven, canvas-rendered, persisted to `localStorage`. The non-obvious parts:

- **Single source of truth for candidates.** `getCandidates()` is the one place
  that computes what can be picked: filter `menus` by `settings.categories`, then
  (if `settings.excludeRecent`) drop the last `settings.recentN` names from
  `history`. Crucially, if that exclusion empties the list it **falls back to the
  full filtered list** and returns `excludedAll: true`. Both `drawWheel()` and
  `spin()` call `getCandidates()`, so the wheel and the pick never disagree — keep
  it that way when editing.

- **Wheel spin math** (the fiddly bit). Segments are drawn clockwise from 3 o'clock;
  the pointer is fixed at the top (`-π/2`). To land segment `target` under the
  pointer, `spin()` computes
  `finalRotation = -π/2 - (target*seg + seg/2) + 2π*extraSpins + jitter`, then eases
  `rotation` from its current value to `finalRotation` (ease-out cubic) via
  `requestAnimationFrame`. The reported result is `list[target]`, which matches the
  visually-stopped segment *because* the rotation targets that segment's center.
  Changing the pointer position or draw direction means re-deriving this formula.

- **Persistence schema** (`localStorage`, `mealRoulette.*` keys, seeded from `SAMPLE`
  on first load): `menus` = `[{name, category}]`; `history` = `string[]` (oldest→newest,
  capped at 100); `settings` = `{excludeRecent, recentN, categories[]}`.
  `save()` writes all three at once; call it after every state mutation.

- **Render/interaction split.** `render*()` functions rebuild DOM from state;
  `afterFilterChange()` redraws the wheel and re-runs `updateSpinAvailability()`
  (which disables the spin button + shows guidance when no candidates exist).
  Controls are disabled during a spin to prevent re-entrancy.

- **XSS surface:** user menu names and picked results are persisted and later shown.
  Result text goes through `escapeHtml()`; menu-list rows use `textContent`. Preserve
  this — never interpolate a menu name straight into `innerHTML`.

## Claude Code tooling (`.claude/`)

These three pieces are meant to work together for reviewing this kind of code:

- **`skills/web-mvp-review/SKILL.md`** — a code-review skill for single-file
  HTML/CSS/vanilla-JS apps (correctness, XSS/security, state & localStorage,
  accessibility, simplification). Named distinctly so it doesn't shadow the
  built-in `/code-review`.
- **`agents/code-reviewer.md`** — a read-only subagent that loads the
  `web-mvp-review` skill (via the Skill tool) and reviews the working diff or named
  files. It reports findings; it does not edit.
- **`hooks/tdd-guard.js`** — a `PreToolUse` hook (`matcher: Edit|Write`) enforcing
  test-first ordering: it blocks edits to production code (`.html`/`.js`/`.ts`/`.jsx`/
  `.tsx`/`.css`, excluding `.claude/` and `plugins/`) unless `git status` shows a
  pending (uncommitted) change to a test file (`tests/**`, `*.test.*`, `*.spec.*`).
  Fails open if git isn't available. It checks ordering only, not pass/fail — this
  repo has no test framework yet. The `web-mvp-test` skill can generate `node:test`
  suites for `index.html`'s inline script to pair with it.
- **`hooks/pre-commit-check.js` + `settings.json`** — a `PreToolUse` hook
  (`matcher: Bash`, filtered by `if: "Bash(git *)"`) that intercepts `git commit`
  and runs the `lint` / `build` / `test` npm scripts **only if they exist** in
  `package.json`. A failure exits 2 and blocks the commit; missing scripts or no
  `package.json` pass through. Editing settings mid-session may require opening
  `/hooks` or restarting for the watcher to reload.
