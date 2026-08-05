// Alex HQ - path resolution for the build scripts (added 2026-08-04, the website split).
//
// WHY THIS EXISTS: build-todos/-life/-projects/-graph.mjs each carried absolute
// "C:/Users/Thinkpad/Desktop/personal-os/..." defaults. Those are wrong the moment the repo is
// cloned to another machine, and they became actively broken when the website moved out of
// work/16-alex-hq/app into its own repo. No script should ever name an absolute path again.
//
// THE ORDER, for every lookup (first hit wins):
//   1. explicit argv          - the caller always overrides, unchanged behaviour
//   2. env var                - PERSONAL_OS_REPO / ALEX_HQ_REPO, for odd layouts + CI
//   3. manifest meta.paths    - the SSOT (system/manifest.json), same well check.mjs reads
//   4. structural default     - derived from this file's own location, so it cannot rot
//
// This module is a THIN ESM wrapper: the website-repo lookup is delegated to the canonical CJS
// implementation at scripts/lib/alex-hq-path.js (which the generator + validator V8 also use), so
// ESM and CJS can never disagree about where the site lives. Python twin: scripts/lib/alex_paths.py.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// scripts/lib -> scripts -> 16-alex-hq -> work -> repo root
export const REPO = process.env.PERSONAL_OS_REPO
  ? path.resolve(process.env.PERSONAL_OS_REPO)
  : path.resolve(HERE, "../../../..");

/** A path inside personal-os. repoPath("vault/me", "gym.md") */
export const repoPath = (...rel) => path.join(REPO, ...rel);

const require = createRequire(import.meta.url);
const hq = require(path.join(REPO, "scripts", "lib", "alex-hq-path.js"));

/** The Alex HQ website repo, split out of work/16-alex-hq on 2026-08-04. Sibling by default. */
export const ALEX_HQ_REPO = hq.root();

/** A path inside the website repo. alexHqPath("public/data", "todos.json") */
export const alexHqPath = (...rel) => path.join(hq.root(), ...rel);

/** Is the website repo actually on this machine? Callers degrade honestly when false. */
export const alexHqExists = () => hq.exists();
