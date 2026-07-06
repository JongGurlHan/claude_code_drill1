# web-mvp-test (Claude Code plugin)

A unit-testing toolkit for single-file **HTML / CSS / vanilla-JS** web MVPs. Pairs
a test-authoring skill with a TDD ordering guard so the two reinforce each other:
the guard nudges you to write the test first, the skill makes writing (and running)
that test easy for code that lives inline in an `index.html`.

| Component | What it is | Where |
|-----------|-----------|-------|
| **`web-mvp-test` skill** | How to write & run `node:test` unit tests for inline browser JS — find the testable logic, load it into Node via a fake-browser harness, cover the branches, run `node --test` | `skills/web-mvp-test/SKILL.md` |
| **Inline-loading harness** | `load-inline.mjs` — extracts the inline `<script>`, stubs DOM/canvas/localStorage, and hands back the app's functions/state (incl. `let`/`const`) for testing, no browser and no dependencies | `skills/web-mvp-test/scripts/load-inline.mjs` |
| **TDD guard hook** | `PreToolUse` (`Edit`/`Write`) hook that blocks edits to production code (`.html/.js/.ts/.jsx/.tsx/.css`, excluding `.claude/` & `plugins/`) unless `git status` shows a pending change to a test file (`tests/**`, `*.test.*`, `*.spec.*`) | `hooks/hooks.json` + `scripts/tdd-guard.js` |

## Install (local marketplace)

The parent `plugins/` directory is a local marketplace. From Claude Code:

```
/plugin marketplace add C:/Project/new_pjt/plugins
/plugin install web-mvp-test@new-pjt-tools
```

Restart or reload when prompted so the hook registers.

## Usage

- **Write tests:** ask Claude to "add unit tests for index.html" (or "test
  `getCandidates`") — the skill triggers on test-authoring requests for browser
  frontend code. It copies the harness into `tests/support/`, writes
  `tests/*.test.mjs`, and runs `node --test`.
- **TDD guard:** once installed, Claude can't edit production code until the working
  tree has a pending (uncommitted) test change. Write/adjust the failing test first
  (red), then implementation is unblocked (green). The guard checks *ordering* only,
  not pass/fail — it can't verify red vs. green without a runner. It **fails open**:
  no git, or not a repo, and it gets out of the way.
- **Wire the runner (optional):** add `"test": "node --test"` to `package.json` so
  the sibling `web-mvp-review` pre-commit hook runs the suite on commit.

## Notes

- Both scripts are plain Node (cross-platform); `node` must be on `PATH`.
- The harness needs no dependencies — `node --test`, `node:test`, and `node:assert`
  ship with Node 18+.
- If you also keep the project-level copies under `.claude/` (skill in
  `.claude/skills/web-mvp-test`, hook in `.claude/hooks/tdd-guard.js` wired via
  `.claude/settings.json`), the skill and hook will be **duplicated** and the guard
  fires twice. Remove one set to avoid overlap.
