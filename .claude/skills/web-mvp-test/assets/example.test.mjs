// example.test.mjs — a starter unit-test suite for a single-file web app, using
// Node's built-in runner. Copy it next to your tests, point HTML at your file,
// and adapt the cases to your app's real functions and storage keys.
//
//   tests/
//     support/load-inline.mjs   ← copy of the skill's scripts/load-inline.mjs
//     example.test.mjs          ← this file
//
// Run with:  node --test
//
// The cases below target the sample "meal roulette" index.html. Each block is a
// pattern, labelled — keep the patterns, swap the specifics.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadInlineApp, plain } from "./support/load-inline.mjs";

// Resolve the HTML relative to this test file so `node --test` works from anywhere.
// Use fileURLToPath, not `.pathname` — on Windows `.pathname` yields "/C:/…",
// which fs then mis-resolves to "C:\C:\…". fileURLToPath gives a correct native path.
const HTML = fileURLToPath(new URL("../index.html", import.meta.url));

// A small fixture builder keeps each test's setup to just what differs.
function seed({ menus = [], history = [], settings = {} } = {}) {
  return {
    localStorage: {
      "mealRoulette.menus": JSON.stringify(menus),
      "mealRoulette.history": JSON.stringify(history),
      "mealRoulette.settings": JSON.stringify({
        excludeRecent: false, recentN: 3, categories: ["한식", "일식", "양식", "중식"],
        ...settings,
      }),
    },
  };
}
const menu = (name, category = "한식") => ({ name, category });

// ── Pattern 1: pure function ────────────────────────────────────────────────
// No state needed — load once, call, assert. Test the real payloads that matter.
test("escapeHtml neutralizes an injection payload", () => {
  const { escapeHtml } = loadInlineApp(HTML, ["escapeHtml"]);
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
  );
  assert.equal(escapeHtml("a & b"), "a &amp; b");
});

// ── Pattern 2: state selector, happy path ───────────────────────────────────
// Seed state via localStorage, then assert what the app derives from it.
test("getCandidates keeps only menus in the active categories", () => {
  const app = loadInlineApp(HTML, ["getCandidates"], seed({
    menus: [menu("김치찌개", "한식"), menu("초밥", "일식")],
    settings: { categories: ["한식"] },
  }));
  const { list, excludedAll } = app.getCandidates();
  // Re-home the vm value with plain() before deep-equality (see harness.md).
  assert.deepEqual(plain(list).map((m) => m.name), ["김치찌개"]);
  assert.equal(excludedAll, false);
});

// ── Pattern 3: the important edge case — a documented fallback branch ────────
// When "exclude recent" would empty the wheel, the app must fall back to the full
// list AND flag it. This is the rule most likely to hide a bug; pin it explicitly.
test("getCandidates falls back to the full list when exclusion empties it", () => {
  const app = loadInlineApp(HTML, ["getCandidates"], seed({
    menus: [menu("김치찌개")],
    history: ["김치찌개"],
    settings: { excludeRecent: true, recentN: 3, categories: ["한식"] },
  }));
  const { list, excludedAll } = app.getCandidates();
  assert.deepEqual(plain(list).map((m) => m.name), ["김치찌개"]);
  assert.equal(excludedAll, true); // fell back, and said so
});

// ── Pattern 4: resilience to corrupt/absent storage ─────────────────────────
// Hand-edited or old localStorage shouldn't brick the app on load — load() should
// swallow the parse error and use its default (the 20-item SAMPLE).
test("a corrupt menus value falls back to the sample data instead of throwing", () => {
  const app = loadInlineApp(HTML, ["menus"], {
    localStorage: { "mealRoulette.menus": "{not valid json" },
  });
  assert.equal(app.menus.length, 20);
});

// ── Pattern 5: deterministic randomness ─────────────────────────────────────
// Override the injected Math.random seam so a "random" pick is predictable, then
// let the (synchronous) spin run to completion and check what it recorded.
test("spin records the segment chosen by the (forced) random draw", () => {
  const app = loadInlineApp(HTML, ["spin", "history"], seed({
    menus: ["A", "B", "C", "D"].map((n) => menu(n)),
    settings: { categories: ["한식"] },
  }));
  app._sandbox.Math.random = () => 0.5; // floor(0.5 * 4) = segment 2 → "C"
  app.spin();
  assert.equal(app.history.at(-1), "C");
});

// ── Pattern 6: smoke test on an empty state ─────────────────────────────────
// Cheap insurance that load-time wiring and the first render survive edge states.
// We don't assert on pixels — only that loading with zero menus doesn't throw.
test("app loads and derives an empty candidate list with no menus", () => {
  const app = loadInlineApp(HTML, ["getCandidates"], seed({ menus: [] }));
  const { list } = app.getCandidates();
  assert.equal(list.length, 0);
});
