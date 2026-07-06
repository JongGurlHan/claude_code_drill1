#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook: pre-commit lint/build/test gate.
 *
 * Wired to fire before Bash tool calls (filtered to `git *` in settings.json).
 * When the command is a `git commit`, it runs the project's npm `lint`, `build`,
 * and `test` scripts — but ONLY the ones that actually exist in package.json.
 * If any fails, the hook exits 2, which blocks the commit and hands the failure
 * output back to Claude. Otherwise (checks pass, no package.json, or not a
 * commit) it exits 0 and the commit proceeds.
 *
 * "Run if present" by design: a project with no package.json (or none of these
 * scripts) commits freely, so this can be dropped into any repo without setup.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// The scripts we gate on, in the order they should run.
const CHECKS = ["lint", "build", "test"];

// --- Read the hook payload from stdin (JSON) ---------------------------------
function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function isGitCommit(command) {
  // Matches `git commit`, `git commit -m ...`, `git commit --amend`, and forms
  // with global options in between (`git -c user.name=x commit`, `git -C dir commit`).
  return /\bgit\s+(?:-[cC]\s+\S+\s+)*commit\b/.test(command);
}

// Walk up from a starting dir looking for the nearest package.json.
function findPackageJson(startDir) {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

function main() {
  let payload = {};
  try {
    payload = JSON.parse(readStdin() || "{}");
  } catch {
    // Malformed payload — don't punish the commit for our parsing trouble.
    process.exit(0);
  }

  const command = (payload.tool_input && payload.tool_input.command) || "";
  if (!isGitCommit(command)) process.exit(0);

  const pkgPath = findPackageJson(process.cwd());
  if (!pkgPath) process.exit(0); // no package.json → nothing to check

  let scripts = {};
  try {
    scripts = JSON.parse(fs.readFileSync(pkgPath, "utf8")).scripts || {};
  } catch {
    process.stderr.write(
      `[pre-commit] Warning: could not parse ${pkgPath}; skipping checks.\n`
    );
    process.exit(0);
  }

  const toRun = CHECKS.filter((name) => typeof scripts[name] === "string");
  if (toRun.length === 0) process.exit(0); // none defined → nothing to check

  const projectDir = path.dirname(pkgPath);
  for (const name of toRun) {
    const result = spawnSync("npm", ["run", "--silent", name], {
      cwd: projectDir,
      shell: true, // needed so `npm`/`npm.cmd` resolves on Windows
      encoding: "utf8",
    });

    if (result.error) {
      process.stderr.write(
        `[pre-commit] ✗ Could not run "npm run ${name}": ${result.error.message}\n` +
          `Commit blocked because the "${name}" check could not be verified.\n`
      );
      process.exit(2);
    }

    if (result.status !== 0) {
      const out = ((result.stdout || "") + (result.stderr || "")).trim();
      process.stderr.write(
        `[pre-commit] ✗ "${name}" failed (exit ${result.status}). Commit blocked.\n\n` +
          (out ? out + "\n" : "")
      );
      process.exit(2); // exit 2 = block the tool call in Claude Code
    }
  }

  // All defined checks passed. Note it on stderr so the pass is visible, then allow.
  process.stderr.write(`[pre-commit] ✓ passed: ${toRun.join(", ")}\n`);
  process.exit(0);
}

main();
