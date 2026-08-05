#!/usr/bin/env bash
# Airbnb Host scheduled wrapper (#13). Close-Out Gate hardened 2026-07-03.
# bash 3.2-compatible (ruling F). Canonical shape: scripts/run-expense-wrangler.sh.
set -euo pipefail
ALEX_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ALEX_ROOT/scripts/lib/common.sh"
alex_root_cd
parse_common_flags "$@"
log_init "airbnb-host"

quota_gate 'airbnb' || exit 0

# Deterministic first (write-first discipline): harvest, THEN rebuild the model.
# --headless is REQUIRED for the scheduled/unattended run (fix 2026-07-14): a HEADED launch has no
# desktop to render into under a scheduler and hangs to a 180s launch timeout (that was the real
# 2026-06-24 failure, NOT an expired login - the session was still valid). Headless reuses the same
# persistent .browser-profile session and works read-only (verified 2026-07-14: logged-in, 38 rows).
# Manual/on-demand runs stay HEADED per RUNBOOK.md (lower bot-detection risk when he is watching).
set +e
python3 "$ALEX_ROOT/work/13-airbnb-host/scrape_airbnb.py" --headless >> "$LOG" 2>&1
scrape_code=$?
set -e

if [ "$scrape_code" -ne 0 ]; then
    # FAIL LOUD (fix, /deep-audit full-repo M2, 2026-07-14): a failed scrape must NOT fall through to
    # ingest, which would rebuild the income model from STALE raw/ and publish it as fresh. That was
    # the silent 2026-06-24 false-success - the browser session timed out, yet the run still reported
    # "37 bookings" on 06-14 data and exited 0. Skip ingest, push RED via close-out, exit non-zero.
    echo "[FAIL] scrape_airbnb.py exited $scrape_code - Airbnb data NOT refreshed. Skipping ingest so stale raw is not published as fresh. Likely the Playwright session expired: run the --setup login (queue: airbnb-playwright-setup)." >> "$LOG"
    OUT="BLOCKED: scrape_airbnb.py failed (exit $scrape_code); income model NOT rebuilt, to avoid publishing STALE Airbnb data as fresh. The Airbnb browser session likely expired - run the Playwright --setup login (queue: airbnb-playwright-setup)."
    close_out 'airbnb' 1
    exit 1
fi

python3 "$ALEX_ROOT/work/13-airbnb-host/ingest_airbnb.py" >> "$LOG" 2>&1 || true

# Then sync Notion + vault from the freshly-written normalized data (no re-scrape).
prompt="Run /airbnb-host monthly-sync: scrape + ingest already ran this run, so raw/bookings-normalized.json and the Excel income model are fresh as of today. Do NOT re-scrape. Read raw/bookings-normalized.json, upsert the Notion Airbnb Bookings DB to match, refresh vault/me/airbnb-studio.md and vault/projects/airbnb-host/status.md and vault/log.md, and flag any new pending requests or discrepancies."

# Model: Sonnet-4-6 (cost cut, Shaheen 2026-07-16).
alex_claude --model claude-sonnet-4-6 \
    -p "$prompt $(alex_verdict_instruction)" \
    --dangerously-skip-permissions

close_out 'airbnb' "$CODE"
