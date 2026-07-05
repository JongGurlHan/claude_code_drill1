#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook: TDD red-green guard.
 *
 * Wired to fire before Edit/Write tool calls. Blocks changes to production
 * code unless the working tree already has a pending (uncommitted) change to
 * a test file — i.e. "write/update a failing test first" (TDD's red step)
 * before touching implementation (the green step).
 *
 * Why git status instead of an in-memory/session flag: it's stateless and
 * can't drift. The pending test edit IS the evidence of "test written but
 * not yet made to pass" — once it's committed (or reverted), the guard
 * re-locks until the next test change shows up.
 *
 * This project has no test framework yet (no package.json), so this guard
 * only enforces *ordering* (test file touched before/alongside impl file),
 * not actual pass/fail status — it can't verify red vs. green without a
 * runner. That's an intentional, honest limitation, not a bug.
 *
 * "Fail open" by design: if git isn't available or this isn't a repo, the
 * guard gets out of the way rather than blocking work it can't reason about.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// Extensions treated as "production code" that the guard gates.
const GUARDED_EXTS = new Set([".html", ".js", ".ts", ".jsx", ".tsx", ".css"]);

// Directories that are tooling, not application code — never gated.
const EXEMPT_DIR_PREFIXES = [".claude/", "plugins/"];

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function toRelPosix(cwd, filePath) {
  const resolved = path.resolve(cwd, filePath);
  return path.relative(cwd, resolved).replace(/\\/g, "/");
}

function isTestFile(relPath) {
  if (/(^|\/)(tests?|__tests__)\//.test(relPath)) return true;
  if (/\.(test|spec)\.[a-zA-Z]+$/.test(relPath)) return true;
  return false;
}

function isExemptDir(relPath) {
  return EXEMPT_DIR_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

function isGuardedImplFile(relPath) {
  if (relPath.startsWith("..")) return false; // outside the repo — not ours to gate
  if (isExemptDir(relPath)) return false;
  if (isTestFile(relPath)) return false;
  return GUARDED_EXTS.has(path.extname(relPath).toLowerCase());
}

// List every file git currently sees as changed (staged, unstaged, and
// untracked), handling porcelain's "R  old -> new" rename lines.
function getChangedFiles(cwd) {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return null; // not a git repo / git missing

  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const body = line.slice(3);
      const arrow = body.indexOf(" -> ");
      return (arrow === -1 ? body : body.slice(arrow + 4)).trim();
    });
}

function main() {
  let payload = {};
  try {
    payload = JSON.parse(readStdin() || "{}");
  } catch {
    process.exit(0); // malformed payload — don't punish the edit for our parsing trouble
  }

  const filePath = payload.tool_input && payload.tool_input.file_path;
  if (!filePath) process.exit(0);

  const cwd = process.cwd();
  const rel = toRelPosix(cwd, filePath);

  if (!isGuardedImplFile(rel)) process.exit(0); // test file, config, or non-code — always allowed

  const changed = getChangedFiles(cwd);
  if (changed === null) process.exit(0); // no git available — fail open

  const hasPendingTestChange = changed.some((f) => isTestFile(f.replace(/\\/g, "/")));
  if (hasPendingTestChange) process.exit(0);

  process.stderr.write(
    `[tdd-guard] Blocked: "${rel}" is production code, but there's no pending test change.\n` +
      `TDD: red -> green -> refactor. Add or update a test (tests/**, or *.test.*/*.spec.*) that\n` +
      `covers this change first, then edit implementation to make it pass.\n`
  );
  process.exit(2); // exit 2 = block the tool call in Claude Code
}

main();
