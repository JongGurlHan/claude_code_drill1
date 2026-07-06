# web-mvp-review (Claude Code plugin)

A code-review toolkit for single-file **HTML / CSS / vanilla-JS** web MVPs. Bundles
three things that work together:

| Component | What it is | Where |
|-----------|-----------|-------|
| **`web-mvp-review` skill** | Review rubric — correctness, XSS/security, state & localStorage, accessibility, simplification | `skills/web-mvp-review/SKILL.md` |
| **`code-reviewer` subagent** | Read-only agent that loads the skill and reviews the working diff or named files (reports, never edits) | `agents/code-reviewer.md` |
| **Pre-commit hook** | `PreToolUse` hook that intercepts `git commit` and runs npm `lint`/`build`/`test` **only if defined** in `package.json`, blocking the commit on failure | `hooks/hooks.json` + `scripts/pre-commit-check.js` |

## Install (local marketplace)

The parent `plugins/` directory is a local marketplace. From Claude Code:

```
/plugin marketplace add C:/Project/new_pjt/plugins
/plugin install web-mvp-review@new-pjt-tools
```

Restart or reload when prompted so the hook registers.

## Usage

- **Review:** ask Claude to "review this with the code-reviewer subagent," or just
  "review my index.html" — the skill triggers on HTML/CSS/JS review requests.
- **Pre-commit gate:** once installed, any `git commit` Claude runs is gated by the
  npm `lint` → `build` → `test` scripts you define in `package.json`. No scripts (or
  no `package.json`) → the commit passes through untouched.

## Notes

- The hook script is plain Node (cross-platform); `node` must be on `PATH`.
- If you also keep the project-level copies under `.claude/`, the skill/agent/hook
  will be **duplicated** (the hook fires twice). Remove one set to avoid overlap.
