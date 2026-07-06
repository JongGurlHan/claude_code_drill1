---
name: web-mvp-test
description: >-
  Write and run unit tests for single-file / small vanilla-JavaScript web apps —
  an index.html with an inline <script>, a small static site, or a no-framework
  prototype — using Node's built-in test runner (node:test), no dependencies and
  no build step. Handles the hard part these apps have: the logic is inline and
  wired to the DOM/canvas/localStorage, so this skill loads it into Node behind a
  tiny fake-browser harness and tests the real functions. Use this skill whenever
  the user asks to write, add, generate, or set up unit tests / a test suite /
  test coverage for browser frontend code, to "test this function" in an
  index.html or web MVP, or to run and debug existing tests for such an app —
  even if they just say "add tests" and the code in question is a web page.
  Prefer this over reaching for Jest/Vitest when the target is a dependency-free
  single-file or small static frontend.
---

# Web MVP Test

Unit-test the JavaScript in single-file / small vanilla-JS web apps (typically one
`index.html` with an inline `<script>`). These apps have no build step and no test
runner, and the logic is tangled with the DOM — so the goal is to isolate the
*testable* logic and exercise it in Node, deterministically, with zero
dependencies.

Use **Node's built-in runner** (`node --test`) with `node:test` + `node:assert`.
It ships with Node, needs no install, and fits an app that deliberately avoids
tooling. Don't reach for Jest/Vitest here unless the user asks — adding a
`node_modules` to a dependency-free MVP is a bad trade.

The core obstacle: you can't `import` an inline `<script>`, and running it in Node
throws because `document`/`localStorage`/`canvas` don't exist. The bundled harness
`scripts/load-inline.mjs` solves this — read **`references/harness.md`** before
writing tests to understand how it works and how to extend it.

## Workflow

### 1. Find the testable logic

Read the app top to bottom and separate logic from presentation. Good targets are
functions and state transitions whose behavior you can state as *input → output*:

- **Pure functions** — string/number/array helpers with no side effects
  (escaping, formatting, clamping, color math). Easiest and highest-value: they
  often guard security (`escapeHtml`) or have fiddly branches.
- **State selectors / derivations** — the function that decides *what the app does*
  from current state (e.g. "which items are eligible right now"). These carry the
  real business rules and the subtle edge cases; prioritize them.
- **Reducers / mutations** — functions that take state + an action and produce new
  state (add, remove, clamp a setting, dedupe, cap a history length).

Skip what needs a real browser to mean anything: pixel output of canvas draws,
animation smoothness, exact layout, event wiring. You can still *call* a render
function to prove it doesn't throw on an edge case (empty list, one item), just
don't assert on pixels.

Prioritize by **branches and edge cases**, not line count. A three-line function
with a fallback path deserves more tests than a long linear render function. Look
for: empty collections, one-element collections, duplicates, all-items-filtered,
fallback/else branches, boundary values (min/max, off-by-one), and any comment
that says "if this empties the list…" — those are the bugs worth pinning down.

### 2. Load the code

**If the logic already lives in a separate `.js` with exports**, just `import` it —
no harness needed. Prefer suggesting this refactor only if the user wants it;
don't force it on a deliberately single-file app.

**If the logic is inline** (the common case), use the bundled harness. Copy it into
the project so the suite is self-contained and runnable without the skill:

```
tests/
  support/load-inline.mjs   ← copy of scripts/load-inline.mjs
  <feature>.test.mjs
```

`loadInlineApp(htmlPath, exportNames, opts)` supplies a fake DOM/localStorage,
runs the inline script, and returns the names you ask for (functions *and* top-level
`let`/`const` state). Seed initial state through `opts.localStorage`, because that's
where the app reads its state from on load:

```js
import { loadInlineApp, plain } from "./support/load-inline.mjs";
const app = loadInlineApp("index.html", ["getCandidates", "escapeHtml"], {
  localStorage: { "mealRoulette.menus": JSON.stringify([{ name: "초밥", category: "일식" }]) },
});
```

Each `loadInlineApp` call is a **fresh load** with its own state — call it once per
scenario rather than trying to reset a shared instance. See `references/harness.md`
for how seeding maps to the app's storage keys and how to stub extra globals.

### 3. Write the tests

Use `node:test` + `node:assert/strict`. One behavior per test, with a name that
reads as a sentence about the rule being checked — the name is the spec.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadInlineApp, plain } from "./support/load-inline.mjs";

// fileURLToPath (not .pathname) — on Windows .pathname gives "/C:/…", which fs
// mis-resolves. This resolves index.html relative to the test file, portably.
const HTML = fileURLToPath(new URL("../index.html", import.meta.url));

test("getCandidates falls back to the full list when recent-exclusion empties it", () => {
  const app = loadInlineApp(HTML, ["getCandidates"], {
    localStorage: {
      "mealRoulette.menus": JSON.stringify([{ name: "김치찌개", category: "한식" }]),
      "mealRoulette.settings": JSON.stringify({ excludeRecent: true, recentN: 3, categories: ["한식"] }),
      "mealRoulette.history": JSON.stringify(["김치찌개"]),
    },
  });
  const { list, excludedAll } = app.getCandidates();
  assert.deepEqual(plain(list).map((m) => m.name), ["김치찌개"]);
  assert.equal(excludedAll, true); // fell back, and flagged that it did
});
```

Guidelines that keep the suite honest:

- **Assert the contract, not the implementation.** Check the returned value and the
  observable state change, not internal call counts. Tests that mirror the code
  break on every refactor and catch nothing.
- **Normalize cross-realm values before deep-equality.** Values returned from the
  harness live in the vm's realm, so `assert.deepStrictEqual(vmArray, [...])` fails
  on a prototype mismatch even when contents match. Wrap the value in `plain()` (or
  compare primitives like `.map(m => m.name).join(",")`). This is the single most
  common surprise — see `references/harness.md`.
- **Cover the edge cases you found in step 1**, one test each: empty, single,
  duplicate, all-filtered, the fallback branch, min/max boundaries.
- **Make it deterministic.** If a function uses `Math.random`/`Date.now`, either
  test the pure part around it or override the global in the sandbox so the outcome
  is fixed. A flaky test is worse than no test. See `references/harness.md` for
  seeding randomness (e.g. testing the wheel-landing math).

`assets/example.test.mjs` is a ready-to-adapt starter covering these patterns.

### 4. Run and interpret

```
node --test          # discovers tests/**/*.test.mjs (Node 18+)
```

Read failures carefully — a red test means one of two very different things:

- **The test is wrong** (bad expectation, unseeded state, cross-realm compare not
  normalized). Fix the test.
- **You found a real bug** in the app. This is the payoff. Don't quietly rewrite the
  test to match buggy behavior — surface it to the user with the concrete trigger
  (inputs → wrong output) and let them decide whether to fix the code. Pinning
  current behavior only makes sense if they explicitly want a characterization test,
  and then say so in the test name.

Report a short summary: how many tests, what they cover, and any real defects the
run exposed.

### 5. Wire it up (optional)

Add a `test` script so the suite runs by name and the repo's pre-commit hook (which
runs `lint`/`build`/`test` when they exist) picks it up automatically:

```json
{ "scripts": { "test": "node --test" } }
```

Creating `package.json` turns a dependency-free app into one with (empty) package
metadata — fine and conventional, but mention it to the user rather than doing it
silently. No dependencies are added; `node --test` is built in.

## What good coverage looks like here

Aim for the rules a user would actually hit, not a line-count number:

- Every branch of the core state selector, including its fallback/else paths.
- Security-sensitive helpers (escaping) against real injection payloads, not just
  `"abc"`.
- Boundary handling: empty state on first load, corrupt/hand-edited localStorage
  (does load fall back instead of throwing?), min/max clamps, dedupe.
- One "doesn't throw" smoke test per render/entry function on an empty and a
  one-item state — cheap insurance that load-time wiring survives edge states.

Stop when the branches are covered and new tests would only restate the same rule.
A tight suite that pins the real logic beats an exhaustive one that asserts trivia.

## Reference files

- **`references/harness.md`** — how `load-inline.mjs` works, the loading strategies
  (separate-module vs. inline-vm), seeding state and randomness, stubbing extra
  globals, and the cross-realm equality gotcha in depth. Read it before writing
  tests against inline code.
- **`assets/example.test.mjs`** — a runnable starter test file demonstrating the
  patterns above; copy and adapt.
- **`scripts/load-inline.mjs`** — the harness itself; copy into the project's
  `tests/support/`.
