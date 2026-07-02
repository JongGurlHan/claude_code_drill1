---
name: web-mvp-review
description: >-
  Reviews single-file / small web frontend code — HTML, CSS, and vanilla
  JavaScript apps (index.html with inline <script>/<style>, small static sites,
  no-framework prototypes). Checks correctness bugs, XSS and other client-side
  security issues, state and localStorage handling, accessibility, and
  simplification opportunities. Use this skill whenever the user asks to review,
  audit, check, or "look over" HTML/CSS/JS frontend code, a landing page, a
  browser MVP, or a static prototype — even if they just say "review my code"
  and the code in question is a web page. Prefer this over a generic review when
  the target is browser-run frontend code rather than a backend service or
  framework app.
---

# Web MVP Review

Review browser-run frontend code (HTML/CSS/vanilla JS, often a single
`index.html`) for real defects and concrete cleanups. These apps have no build
step, no type checker, and no test suite catching mistakes — so the review is
the main safety net. Bias toward finding bugs a user would actually hit when
they open the page and click around.

## How to run a review

1. **Identify the scope.** If reviewing a diff, focus on changed lines but read
   enough surrounding code to judge them. If reviewing a whole file, read it top
   to bottom once before flagging anything — inline scripts share global state,
   so a bug is often the interaction between two distant blocks.
2. **Trace the actual runtime.** Mentally load the page: what runs on load, what
   each event handler does, what state each mutation touches. Most frontend bugs
   live in event handlers and shared mutable state, not in isolated functions.
3. **Verify before flagging.** Only report an issue you can tie to a concrete
   failure — an input, a click sequence, or a state that produces a wrong result,
   a crash, or a security hole. If you're guessing, say so or drop it.
4. **Report findings** in the format below, most severe first.

## Focus areas

Walk these five lenses. They're ordered by how much damage a miss does.

### 1. Correctness bugs
The page runs untyped in the browser; small mistakes silently break behavior.
- **Event & state flow**: handlers firing in the wrong order, stale closures
  capturing old state, re-entrancy (e.g. a button that can be clicked mid-animation
  and corrupts state), listeners double-bound on re-render.
- **Off-by-one / index math**: array indexing, modulo, rounding, `parseInt`
  without radix, `NaN` propagating through arithmetic (e.g. from an empty input).
- **Canvas / animation math**: angle and coordinate math, `requestAnimationFrame`
  loops that never terminate, the visible result disagreeing with the reported
  result.
- **Async / timing**: promises not awaited, race between a timer and user input,
  work continuing after the state it depends on changed.
- **DOM assumptions**: querying an element that may not exist, reading `.value`
  from the wrong node, trusting `parseInt`/`parseFloat` of user text.
- **Edge cases**: empty collections, one-element collections, duplicate entries,
  very long strings, all-items-filtered-out. State the trigger explicitly.

### 2. Security (client-side)
- **XSS via `innerHTML`**: any user-controlled or persisted string written through
  `innerHTML`/`insertAdjacentHTML`/`document.write` is an injection. Check whether
  it's escaped or should use `textContent`. Data from `localStorage` counts as
  untrusted — it may have been written by an earlier XSS or edited by hand.
- **Unsafe sinks**: `eval`, `new Function`, `setTimeout("string")`, assigning to
  `location`/`href` from user input (`javascript:` URLs), `target="_blank"`
  without `rel="noopener"`.
- **Data handling**: secrets or API keys hardcoded in client JS (always visible to
  users), unvalidated data trusted after a round-trip through storage or URL params.

### 3. State & localStorage
Persistence is where "works on my machine, breaks on reload" bugs hide.
- **Serialization**: `JSON.parse` on stored data without a try/catch — corrupt or
  hand-edited storage throws and can brick the whole app on load.
- **Schema drift**: old data in `localStorage` missing fields the new code assumes;
  no migration or default fallback.
- **Save timing**: state mutated in memory but never persisted (or persisted before
  the mutation), so a reload loses or reverts it. Trace each `save()` call site.
- **Unbounded growth**: history/log arrays that only ever push, filling storage.
- **Keys**: collisions with other apps on the same origin; missing namespace prefix.

### 4. Accessibility
Cheap to fix, easy to forget, and it's a correctness issue for keyboard/screen-reader users.
- Interactive elements built from `<div>`/`<span>` instead of `<button>`/`<a>`
  (not keyboard-focusable, no Enter/Space activation).
- Missing labels: form inputs without `<label>`/`aria-label`, icon-only buttons
  without accessible text, images without `alt`.
- Color-only signaling, low contrast, focus outlines removed with no replacement.
- Dynamic result text that a screen reader won't announce (consider `aria-live`).

### 5. Simplification & reuse
Only after correctness. Quality cleanups, not nitpicks.
- Duplicated logic that should be one helper; repeated DOM lookups that could be
  cached; hand-rolled code a small built-in replaces.
- Dead code, unused variables, unreachable branches.
- Over-complex expressions that a reader has to decode. Suggest the simpler form.
- Do **not** invent style rules the file doesn't already follow, and don't propose
  frameworks/build tooling for a deliberately dependency-free MVP.

## Output format

Report only what survives verification. If nothing does, say so plainly — a clean
review is a valid result, don't manufacture findings. Otherwise, most severe first:

```
## Review: <file(s)>

### 🔴 <one-line summary of the defect>
- **Where:** `path:line`
- **Category:** correctness | security | state | accessibility | simplification
- **Why it breaks:** concrete trigger → wrong outcome (inputs/click sequence/state)
- **Fix:** the specific change (a diff or a precise sentence)

### 🟡 <next finding>
...

### ✅ Looks good
- brief note on what was checked and is solid, so the user knows coverage
```

Severity: 🔴 breaks for real users or a security hole · 🟡 wrong on an edge case or
a real cleanup worth doing · 🟢 minor/optional. Give each finding a `path:line` so
it's clickable, and make every "Why it breaks" a scenario, not a vibe. Keep it tight
— the user wants the shortlist that matters, not an exhaustive lint dump.
