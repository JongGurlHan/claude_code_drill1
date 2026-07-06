// load-inline.mjs — Load the inline <script> of a single-file HTML app into Node
// so its functions and state can be unit-tested without a real browser.
//
// The problem it solves: in an app like index.html all the logic lives in one
// inline <script> that wires itself to the DOM at load time (getElementById,
// canvas.getContext, addEventListener) and reads its initial state from
// localStorage. You can't `import` it, and running it as-is throws because
// `document`/`localStorage` don't exist in Node. This harness supplies just
// enough of a fake browser for the script to finish loading, then hands back the
// functions/state you name so tests can call them directly.
//
// Copy this file into the project (e.g. tests/support/load-inline.mjs) so the
// test suite runs on its own, then import it from your test files.
import fs from "node:fs";
import vm from "node:vm";

// A universal no-op stand-in for a DOM element or a canvas 2D context. Reading
// any property returns a callable that yields another stub; writing any property
// is recorded. That's enough for load-time wiring and render calls (ctx.arc(),
// el.onclick = fn, el.style.x = y) to run without throwing. We never assert on
// these — we only need them not to crash the script before our functions exist.
function makeStub() {
  const store = {};
  const fn = () => makeStub();
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop in store) return store[prop];
      if (prop === "style") return (store.style = makeStub());
      // width/height are read into arithmetic (canvas.width / 2); give a number.
      if (prop === "width" || prop === "height") return 440;
      return (..._args) => makeStub();
    },
    set(_t, prop, val) { store[prop] = val; return true; },
  });
}

function makeLocalStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    _dump: () => Object.fromEntries(map), // test helper, not part of the DOM API
  };
}

function makeDocument() {
  const byId = new Map();
  const el = (id) => {
    if (!byId.has(id)) byId.set(id, makeStub());
    return byId.get(id);
  };
  return {
    getElementById: el,
    querySelector: () => makeStub(),
    querySelectorAll: () => [],
    createElement: () => makeStub(),
    body: makeStub(),
    head: makeStub(),
    addEventListener: () => {},
  };
}

/**
 * Load a single-file HTML app's inline script into a sandbox.
 *
 * @param {string} htmlPath   path to the .html file
 * @param {string[]} exportNames  names declared in the script to hand back
 *   (function declarations, `let`/`const` state — anything in the script's top
 *   scope). We can't reach `let`/`const` bindings from outside a vm the normal
 *   way, so we append an epilogue *inside the same scope* that collects them.
 * @param {object} [opts]
 * @param {object} [opts.localStorage]  seed values, e.g. { "app.menus": "[...]" }
 *   Each fresh load starts from this state, so give one call per scenario.
 * @param {number} [opts.scriptIndex]   which <script> block (default: last)
 * @returns {object} the named exports, plus `_sandbox` and `_localStorage`.
 */
export function loadInlineApp(htmlPath, exportNames, opts = {}) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const blocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]);
  if (blocks.length === 0) throw new Error(`no <script> block in ${htmlPath}`);
  const idx = opts.scriptIndex ?? blocks.length - 1;
  const code = blocks[idx];

  // Guarded so a name missing in this particular app yields undefined instead of
  // a ReferenceError (typeof on an undeclared name is safe).
  const epilogue =
    "\n;globalThis.__TEST_EXPORTS__ = {" +
    exportNames
      .map((n) => `${n}: (typeof ${n} !== "undefined" ? ${n} : undefined)`)
      .join(", ") +
    "};";

  let clock = 0;
  let rafDepth = 0;
  const sandbox = {
    document: makeDocument(),
    localStorage: makeLocalStorage(opts.localStorage),
    // Run animation callbacks synchronously, advancing a virtual clock by a large
    // step each frame so duration-based easing reaches t=1 on the first frame — a
    // spin()-style flow runs to completion (and calls its finish handler) the
    // instant it's kicked off, whether during load or from a test. The depth
    // guard stops a genuinely perpetual rAF loop from spinning forever.
    requestAnimationFrame: (cb) => {
      if (rafDepth > 5000) return 0;
      clock += 1e6;
      rafDepth++;
      try { cb(clock); } finally { rafDepth--; }
      return 0;
    },
    cancelAnimationFrame: () => {},
    performance: { now: () => clock },
    // A Math whose methods delegate to the real one but whose `random` a test can
    // override (`app._sandbox.Math.random = () => 0`) to make a draw deterministic.
    // The context's own intrinsic Math isn't reachable from outside, so we inject
    // this seam. Object.create keeps floor/PI/etc. working via the prototype chain.
    Math: Object.create(Math),
    structuredClone: (v) => structuredClone(v),
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(code + epilogue, sandbox, { filename: htmlPath });

  const exports = sandbox.__TEST_EXPORTS__ ?? {};
  exports._sandbox = sandbox;
  exports._localStorage = sandbox.localStorage;
  return exports;
}

// Re-home a value produced inside the vm into the test realm. Objects/arrays the
// app returns carry the *sandbox's* Array/Object prototypes, so
// `assert.deepStrictEqual(vmArray, [1, 2])` fails on a prototype mismatch even
// when the contents match. JSON round-tripping copies the data into native
// test-realm objects so strict deep-equality works. Use it on the value you
// assert against, not on live state you intend to mutate.
export function plain(v) {
  return JSON.parse(JSON.stringify(v));
}
