# The inline-loading harness, in depth

`scripts/load-inline.mjs` exists because the JavaScript in these apps isn't
importable and can't run in bare Node. This file explains what it does, the
choices behind it, and how to extend it when an app needs more than the defaults.

## Table of contents

- [Why you can't just import it](#why-you-cant-just-import-it)
- [What loadInlineApp does, step by step](#what-loadinlineapp-does-step-by-step)
- [Seeding initial state](#seeding-initial-state)
- [The `let`/`const` export trick](#the-letconst-export-trick)
- [The cross-realm equality gotcha](#the-cross-realm-equality-gotcha)
- [Making randomness deterministic](#making-randomness-deterministic)
- [Stubbing extra globals](#stubbing-extra-globals)
- [When to refactor instead](#when-to-refactor-instead)

## Why you can't just import it

The logic lives inside `<script>…</script>` in an HTML file. There's no
`export`, so `import` has nothing to grab. And the script assumes a browser: at
load time it runs `const canvas = document.getElementById("wheel")`,
`canvas.getContext("2d")`, `localStorage.getItem(...)`, `addEventListener(...)`,
and an `init()` that renders. In plain Node every one of those is a
`ReferenceError` or a throw. So two problems have to be solved together: **get the
code to run at all**, and **get a handle on its functions/state afterwards**.

## What loadInlineApp does, step by step

1. **Extract the script.** Reads the HTML and pulls the inline `<script>` bodies
   with a regex. By default it uses the *last* block (apps usually put their app
   script last, after any config). Override with `opts.scriptIndex` if needed.
   This is deliberately simple text extraction — it's fine for single-file apps
   with one real script; it is not a full HTML parser.
2. **Build a fake browser.** Creates stub `document`, `localStorage`,
   `requestAnimationFrame`, `performance`, etc. (details below), enough that the
   script's load-time wiring runs without throwing.
3. **Append an export epilogue** to the script source so top-level `let`/`const`
   bindings become reachable (see [the trick](#the-letconst-export-trick)).
4. **Run it in a `vm` context** (`vm.runInContext`) with the fake browser as the
   global. The script executes exactly as written, including `init()`.
5. **Drain animation frames.** Any `requestAnimationFrame` callbacks the script
   queued are run synchronously with a large timestamp, so eased animations reach
   their end state (a spin "completes") instead of hanging.
6. **Return the named exports**, plus `_sandbox` (the whole global) and
   `_localStorage` (so tests can inspect what was persisted).

The stubs are intentionally dumb. A `Proxy`-based universal element answers *any*
property read with a callable that returns another stub, and records any write.
That means `ctx.beginPath()`, `el.style.background = …`, `el.onclick = fn`,
`el.append(child)` all no-op instead of crashing. We never assert on them — their
only job is to let the real logic load.

## Seeding initial state

The app reads its starting state from `localStorage` on load:

```js
let menus    = load(KEY.menus,    SAMPLE);
let history  = load(KEY.history,  []);
let settings = load(KEY.settings, { excludeRecent: false, recentN: 3, categories: [...] });
```

So to put the app into a specific state for a test, seed the same keys. Values are
strings, exactly as the browser stores them — `JSON.stringify` your fixtures:

```js
const app = loadInlineApp(HTML, ["getCandidates"], {
  localStorage: {
    "mealRoulette.menus":    JSON.stringify([{ name: "초밥", category: "일식" }]),
    "mealRoulette.settings": JSON.stringify({ excludeRecent: false, recentN: 3, categories: ["일식"] }),
    "mealRoulette.history":  JSON.stringify([]),
  },
});
```

Find the real key names in the app (here the `KEY` object) and the shape of each
value (the `SAMPLE`/defaults). Omit a key to let the app fall back to its own
default — which is itself worth a test: seed *nothing* and assert the defaults, or
seed **corrupt** data (`"mealRoulette.menus": "{oops"`) and assert `load` falls
back instead of throwing.

Because each `loadInlineApp` call re-runs the script from scratch, every test gets
an isolated instance. Don't try to share one `app` across scenarios and reset it —
call the loader again with different seed data.

## The `let`/`const` export trick

A `vm` context lets you read globals off the sandbox object *after* running — but
only `var` and `function` declarations become global properties. Top-level `let`
and `const` (like `menus`, `settings`, `CATEGORIES`) create lexical bindings that
are **not** properties of the global, so `sandbox.menus` is `undefined` even
though the binding exists.

The workaround: append a small epilogue to the *source string* before running it,
so the epilogue lives in the same lexical scope and can see those bindings:

```js
globalThis.__TEST_EXPORTS__ = {
  getCandidates: (typeof getCandidates !== "undefined" ? getCandidates : undefined),
  menus:         (typeof menus         !== "undefined" ? menus         : undefined),
  // …one per requested name
};
```

`typeof` guards keep a name that doesn't exist in this app from throwing a
`ReferenceError` — it just comes back `undefined`. After the run, the harness reads
`sandbox.__TEST_EXPORTS__`.

Consequence for tests: you get the **live** state objects. Mutating them in place
(`app.settings.categories.push("중식")`, `app.history.push("초밥")`) is visible to
the app's functions, because they close over the same objects. But *reassignments
the app makes internally* (`history = history.slice(-100)`) won't rebind your
captured reference. When you need a clean slate, reload — don't fight the binding.

## The cross-realm equality gotcha

This one bites everyone once. A `vm` context is a separate realm with its **own**
`Array`, `Object`, etc. An array the app returns is a real array, but
`vmArray instanceof Array` (your realm's Array) is `false`, and
`assert.deepStrictEqual(vmArray, [1, 2])` **fails on a prototype mismatch** even
though the contents are identical. You'll see a baffling diff where both sides
print the same values.

Two clean fixes:

- **Re-home the value** with the exported `plain()` helper (a JSON round-trip),
  then compare: `assert.deepStrictEqual(plain(list).map(m => m.name), ["초밥"])`.
  Spreading also re-homes the outer array: `[...list]`.
- **Compare primitives.** Reduce to strings/numbers before asserting:
  `assert.equal(list.map(m => m.name).join(","), "초밥")`. Primitives are
  realm-agnostic, so this always works.

Use `plain()` on the value you *assert against*, not on live state you intend to
mutate (the copy won't be wired to the app).

## Making randomness deterministic

Functions that call `Math.random()` or `Date.now()` can't be asserted directly. Two
approaches:

- **Test the pure part.** Often the random pick and the logic around it are
  separable — test the deterministic transformation and leave the draw alone.
- **Override the injected seam.** The harness injects an overridable `Math`
  (`Object.create(Math)` — real `floor`/`PI`/etc. via the prototype, but a
  `random` you can replace). The context's own intrinsic `Math` isn't reachable
  from outside, which is exactly why the harness supplies this seam. Pin it right
  after loading, before calling the function:

  ```js
  const app = loadInlineApp(HTML, ["spin", "history"]);
  app._sandbox.Math.random = () => 0; // force target = segment 0
  app.spin();
  assert.equal(app.history.at(-1), expectedName);
  ```

  This is how you test the wheel-landing math: force `Math.random` to a known
  value, run the spin (animation frames run synchronously, so it completes and
  records its pick in one call), then assert the reported result is the intended
  segment. With `n` items, `spin` uses `Math.floor(Math.random() * n)` for the
  target, so `random = k/n` selects segment `k`. That formula is the fiddly bit
  worth pinning down.

For other intrinsics the app relies on for time/identity — `Date.now()`,
`crypto.randomUUID()` — add your own overridable version to the `sandbox` object
in `load-inline.mjs` (e.g. `Date: class extends Date { static now() { return 0; } }`,
or a plain `crypto: { randomUUID: () => "test-uuid" }`). Only `Math` is injected by
default because randomness is the common case; keep the sandbox minimal otherwise.

## Stubbing extra globals

The defaults cover DOM, canvas, `localStorage`, `requestAnimationFrame`,
`performance`, `console`, timers, and `structuredClone`. If an app uses something
else and throws on load (`fetch`, `matchMedia`, `crypto.randomUUID`,
`URLSearchParams`, `navigator`), add it. Extend the `sandbox` object in
`load-inline.mjs`:

```js
const sandbox = {
  // …existing…
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  crypto: { randomUUID: () => "test-uuid", getRandomValues: (a) => a.fill(0) },
};
```

Keep stubs minimal and behavior-neutral — just enough to get past load. If a test
needs a stub to *do* something specific (e.g. `fetch` returning fixture data),
prefer overriding `app._sandbox.fetch` per-test after loading, so each scenario
controls its own doubles.

## When to refactor instead

The harness is the right tool for a genuinely single-file app you want to keep that
way. But if the user is open to a light refactor, extracting the logic into a
plain `.js` module with `export`s is simpler and needs no harness — tests just
`import` it, and the HTML loads it with `<script type="module" src="app.js">`. A
middle path that stays browser-compatible is a guarded export at the end of the
inline script:

```js
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getCandidates, escapeHtml /* … */ };
}
```

`module` is undefined in the browser, so this is a no-op there, while Node can
`require` it. Offer these as options; don't impose them on an app that intentionally
ships as one file.
