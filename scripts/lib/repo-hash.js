// scripts/lib/repo-hash.js
// THE one file-hashing implementation (bash migration Phase 5, 2026-08-05).
//
// WHY THIS EXISTS: before the migration, scripts/stale-status-check.js:40 carried a comment saying it
// hashed "the same way check.ps1's Get-Sha does" - a second implementation, kept in agreement by a
// comment. That duplication existed BECAUSE the checker was trapped in PowerShell and could not be
// imported. The migration plan named it as evidence that the checker belonged in Node (§0), so
// porting C8 deletes one of the two copies instead of creating a third. Both callers now import here.
//
// CASE (W22): PowerShell's `Get-FileHash -Algorithm SHA256` returned UPPERCASE hex; Node's crypto and
// coreutils' sha256sum return lowercase. Baselines written before the migration are full of uppercase
// digests, so every comparison goes through sameHash(), which is case-insensitive. Without that, the
// first Monday sweep after the cutover would have reported every single project as drifted - 32 false
// findings at once, which is how a checker stops being read.
//
// Lowercase is the canonical form for anything written from now on.
'use strict';
const fs = require('fs');
const crypto = require('crypto');

/** SHA-256 of a file as lowercase hex, or null when it cannot be read. */
function sha(p) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  } catch (_) {
    return null;
  }
}

/**
 * Compare two digests. Case-insensitive on purpose (see W22 above), and null-safe: a missing file
 * must never compare EQUAL to another missing file, because "both absent" is not "unchanged".
 */
function sameHash(a, b) {
  if (!a || !b) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * baseline.json may still carry a UTF-8 BOM from PowerShell 5.1's `Set-Content -Encoding utf8`, which
 * JSON.parse rejects. Strip it on read. Kept through the migration because a baseline file written by
 * the old checker survives the cutover - it is exactly the file C8 needs to keep reading.
 * New writes are BOM-free (Node), so this becomes a no-op once a --init has run on the new checker.
 */
function readJsonBomSafe(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
}

module.exports = { sha, sameHash, readJsonBomSafe };
