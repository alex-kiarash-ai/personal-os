'use strict';
/*
 * scripts/mail-channel-check.js - the inbound mail-channel watchdog (2026-08-23).
 *
 * WHY THIS EXISTS. On 2026-08-23 Shaheen found that shaheen@shaheenkiarash.com, the ONLY contact
 * address on his live portfolio site, had stopped delivering. Last real mail: 2026-06-08. Nothing
 * anywhere went red, because nothing was broken in a way any component could see: Cloudflare was
 * up, the MX and SPF were right, Gmail was up, email-triage ran clean every morning. Cloudflare
 * Email Routing behaviour DEPENDS ON THE CATCH-ALL, and that distinction is load-bearing:
 *   catch-all ENABLED + drop  -> unknown addresses are accepted then binned. Silent to everyone.
 *   catch-all DISABLED        -> unknown addresses are REJECTED at SMTP. The SENDER gets a bounce.
 * On this zone the catch-all is DISABLED (read from the API 2026-08-23), so a missing rule is NOT
 * silent: whoever wrote to the address finds out, even though Shaheen never does. That is why the
 * config leg below still matters, and why a dropped message should always be chased at the SENDER.
 *
 * The system had checks that its own JOBS ran. It had no check that expected mail ARRIVED.
 *
 * TWO LEGS, because neither one alone covers both addresses:
 *   1. CONFIG  - ask the Cloudflare API whether each declared address still has an enabled routing
 *                rule pointing at the verified Gmail destination. This is the only thing that can
 *                watch a near-zero-traffic address like shaheen@, where silence means nothing.
 *   2. OUTCOME - has mail actually arrived inside each channel's declared window. Config being
 *                right does not prove delivery. Gmail is only reachable over MCP, so the morning
 *                brief writes a daily stamp file and this script reads THAT (the C20 pattern),
 *                which keeps check.ps1's "no network except the one HQ push" contract intact.
 *                A stale stamp is itself drift: it means the daily leg stopped running, which is
 *                this same bug one level up.
 *
 * HOUSE RULES honoured here:
 *   - Never report an UNPROVEN state in the same words as a FAILED one (the C20 / F-14 lesson).
 *     "never stamped" and "no rule found" are different sentences on purpose.
 *   - Fail LOUD, not open. An unreachable Cloudflare API is reported as unknown and is drift; it
 *     is never quietly green. A monitor that fails silently recreates the bug it was built for.
 *   - A channel that declares no cadence is deliberately not asserted, rather than assigned an
 *     invented window (the n8n-active-check leg 2b convention).
 *
 * Registry: system/mail-channels.json (add a channel = one row, no code change).
 * Exit 0 = clean, 2 = drift, 1 = the checker itself broke. --dry skips the HQ push. --json for machines.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const REGISTRY = path.join(REPO, 'system', 'mail-channels.json');
const CF_TOKEN_FILE = path.join(REPO, 'work', '18-recovery-layer', 'config', 'cloudflare-api-token.txt');
const HQ_TOKEN_FILE = path.join(REPO, 'work', '16-alex-hq', 'config', 'alex-hq-token.txt');
const CF_API = 'https://api.cloudflare.com/client/v4';
const DRY = process.argv.includes('--dry');
const AS_JSON = process.argv.includes('--json');

const drift = [];
const notes = [];
function addDrift(msg) { drift.push(msg); }
function note(msg) { notes.push(msg); }

async function cf(pathname, token) {
  const r = await fetch(`${CF_API}${pathname}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.json().catch(() => null);
  if (!r.ok || !body || body.success !== true) {
    const err = body && body.errors && body.errors.length
      ? body.errors.map((e) => e.message).join('; ')
      : `HTTP ${r.status}`;
    throw new Error(err);
  }
  return body.result;
}

/* ---- leg 1: config, via the Cloudflare API ---------------------------------------------- */
async function configLeg(reg) {
  const watched = reg.channels.filter((c) => c.config_probe);
  if (!watched.length) return;

  let token = null;
  try { token = fs.readFileSync(CF_TOKEN_FILE, 'utf8').trim(); } catch { /* absent */ }
  if (!token) {
    addDrift(
      'config leg UNPROVEN (not failed): no Cloudflare API token at ' +
      'work/18-recovery-layer/config/cloudflare-api-token.txt, so ' +
      `${watched.length} address(es) incl. the PUBLIC ${watched[0].address} have no watcher at all. ` +
      'Provision: human-actions cf-email-routing-token (read-only, Zone > Email Routing Rules > Read, this zone only).'
    );
    return;
  }

  let zone, rules, dests, destsErr = null;
  try {
    const zones = await cf(`/zones?name=${encodeURIComponent(reg.zone)}`, token);
    if (!zones.length) {
      addDrift(`zone ${reg.zone} not visible to this Cloudflare token (wrong zone or scope)`);
      return;
    }
    zone = zones[0];
    rules = await cf(`/zones/${zone.id}/email/routing/rules?per_page=200`, token);
    // Account-scoped, so it needs a DIFFERENT permission from the zone-scoped rules read and can
    // be refused on its own. Capture WHY rather than swallowing it: the original `.catch(() => null)`
    // made a refused endpoint indistinguishable from a verified destination, so the check reported
    // clean while one of its assertions had never run. That is a fail-open, in the file whose own
    // header forbids fail-open. Found 2026-08-23 by testing the endpoint instead of trusting it.
    dests = await cf(`/accounts/${zone.account.id}/email/routing/addresses?per_page=200`, token)
      .catch((e) => { destsErr = e.message; return null; });
  } catch (e) {
    // Fail LOUD. An unreachable API is unknown, never green.
    addDrift(`config leg UNKNOWN: Cloudflare API unreachable or refused (${e.message}) - the routing rules could NOT be verified this run`);
    return;
  }

  const verified = new Set((dests || []).filter((d) => d.verified).map((d) => String(d.email).toLowerCase()));
  if (!dests) {
    // UNPROVEN, worded differently from FAILED on purpose (the C20 / F-14 lesson).
    addDrift(
      `destination ${reg.destination} could NOT be verified this run: the account-scoped `
      + `email/routing/addresses endpoint was refused (${destsErr || 'no reason given'}). `
      + `The forwards may be perfectly fine - this assertion simply did not run. `
      + `Grant the token Account > Email Routing Addresses > Read to close it.`
    );
  } else if (!verified.has(String(reg.destination).toLowerCase())) {
    addDrift(`destination ${reg.destination} is NOT verified in Cloudflare - every forward on this zone is dead or dying`);
  } else {
    note(`destination ${reg.destination} is verified in Cloudflare`);
  }

  // The catch-all decides what a MISSING rule does, and the two outcomes need different words.
  // Enabled+drop = accepted then binned, nobody is told. Disabled = rejected at SMTP, the sender
  // is told but Shaheen is not. Read it rather than assume it: this zone had it DISABLED, which
  // is the opposite of what the first version of this file asserted.
  const catchAll = rules.find((r) => (r.matchers || []).some((m) => m.type === 'all'));
  const catchAllDrops = !!(catchAll && catchAll.enabled
    && /drop/i.test((catchAll.actions || []).map((a) => a.type).join(',')));
  if (catchAllDrops) {
    note('catch-all is ENABLED and set to DROP: any address without its own rule is accepted then silently discarded, with no bounce to the sender - nobody finds out');
  } else if (catchAll) {
    note(`catch-all present but ${catchAll.enabled ? 'not a drop action' : 'DISABLED'}: an address without its own rule is REJECTED at SMTP, so the sender gets a bounce (Shaheen still hears nothing)`);
  }

  for (const ch of watched) {
    const want = ch.address.toLowerCase();
    const rule = rules.find((r) => (r.matchers || []).some(
      (m) => m.type === 'literal' && m.field === 'to' && String(m.value).toLowerCase() === want
    ));
    if (!rule) {
      addDrift(`${ch.address} has NO routing rule on ${reg.zone} - mail to it is ${catchAllDrops ? 'accepted and silently discarded (nobody is told)' : 'REJECTED at SMTP (the sender gets a bounce; Shaheen still hears nothing)'} (${ch.severity}: ${ch.severity_why || 'declared channel'})`);
      continue;
    }
    if (!rule.enabled) {
      addDrift(`${ch.address} routing rule exists but is DISABLED (${ch.severity})`);
      continue;
    }
    const fwd = (rule.actions || [])
      .filter((a) => a.type === 'forward')
      .flatMap((a) => a.value || [])
      .map((v) => String(v).toLowerCase());
    if (!fwd.includes(String(reg.destination).toLowerCase())) {
      addDrift(`${ch.address} forwards to [${fwd.join(', ') || 'nothing'}], expected ${reg.destination}`);
      continue;
    }
    note(`${ch.address} rule enabled -> ${reg.destination}`);
  }
}

/* ---- leg 2: outcome, via the daily stamp the morning brief writes ------------------------ */
function outcomeLeg(reg) {
  const stampPath = path.join(REPO, reg.stamp_file);
  let stamp = null;
  try { stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8')); } catch { /* absent */ }

  if (!stamp) {
    addDrift(
      `outcome leg UNPROVEN (not failed): ${reg.stamp_file} does not exist yet, so no arrival has ` +
      'ever been recorded. The next morning-brief run writes it. This is not a delivery failure.'
    );
    return;
  }

  // Three distinct states, deliberately worded differently: unreadable, clock-skewed, and rotted.
  // Collapsing them would report a timezone slip in the same words as a dead monitor.
  const ageH = (Date.now() - new Date(stamp.checked_at).getTime()) / 3600000;
  const SKEW_TOLERANCE_H = 26; // a stamp written "today" in local time can read as future in UTC
  if (Number.isNaN(ageH)) {
    addDrift(`mail-channel stamp has an unreadable checked_at (${stamp.checked_at}) - cannot tell whether the daily check is running`);
  } else if (ageH < -SKEW_TOLERANCE_H) {
    addDrift(`mail-channel stamp checked_at is ${Math.abs(ageH).toFixed(0)}h in the FUTURE (${stamp.checked_at}) - clock skew or a hand-edited stamp, so its freshness cannot be trusted`);
  } else if (ageH > reg.stamp_max_age_hours) {
    addDrift(`the mail-channel stamp is ${ageH.toFixed(0)}h old (>${reg.stamp_max_age_hours}h): the DAILY outcome check has stopped running, so arrivals are currently unwatched`);
  }

  for (const ch of reg.channels) {
    if (ch.max_silence_days == null) continue; // cadence deliberately not asserted
    const seen = (stamp.channels || {})[ch.address];
    if (!seen || !seen.last_seen) {
      addDrift(`${ch.address}: no arrival ever recorded in the stamp (UNPROVEN, not a failure - it may simply not have been observed yet)`);
      continue;
    }
    const days = (Date.now() - new Date(seen.last_seen).getTime()) / 86400000;
    if (days > ch.max_silence_days) {
      addDrift(`${ch.address}: no mail arrived in ${days.toFixed(1)} days (window ${ch.max_silence_days}d) - the forward may be dead`);
    } else {
      note(`${ch.address} last arrival ${days.toFixed(1)}d ago (window ${ch.max_silence_days}d)`);
    }
  }
}

async function pushHQ(status, headline, n) {
  if (DRY) { console.log(`DRY: would push infra/mail_channels ${status}: ${headline}`); return; }
  try {
    const token = fs.readFileSync(HQ_TOKEN_FILE, 'utf8').trim();
    await fetch('https://n8n.shaheenkiarash.com/webhook/alex-push', {
      method: 'POST',
      headers: { 'X-Alex-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: 'infra', metric_key: 'mail_channels', value_num: n, headline, status }),
    });
  } catch (e) { console.log(`HQ push failed (non-fatal): ${e.message}`); }
}

(async () => {
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  } catch (e) {
    // The registry is GITIGNORED on purpose: it maps every alias on the zone to the destination
    // inbox, and two of those aliases are unpublished. On a fresh clone it is restored from the
    // 21:45 encrypted vault backup, not from git. Say that plainly instead of dying on ENOENT.
    if (e.code === 'ENOENT') {
      console.error(
        'mail-channel-check: system/mail-channels.json is missing. It is gitignored by design (it '
        + 'pairs unpublished aliases with the destination inbox, so it must not ride a public repo) '
        + 'and is restored from the encrypted vault backup, not from git. Restore it, or recreate it '
        + 'from the schema documented in work/18-recovery-layer/CLAUDE.md check 25.'
      );
    } else {
      console.error(`mail-channel-check: cannot read ${REGISTRY}: ${e.message}`);
    }
    process.exit(1);
  }

  await configLeg(reg);
  outcomeLeg(reg);

  if (AS_JSON) {
    console.log(JSON.stringify({ drift, notes, ok: drift.length === 0 }, null, 2));
  } else {
    for (const n of notes) console.log(`ok:    ${n}`);
    for (const d of drift) console.log(`DRIFT: ${d}`);
    if (!drift.length) {
      console.log(`mail channels clean (${reg.channels.filter((c) => c.config_probe).length} watched on ${reg.zone})`);
    }
  }

  const headline = drift.length ? drift[0] : `${reg.zone} mail channels verified`;
  await pushHQ(drift.length ? 'amber' : 'green', headline.slice(0, 240), drift.length);
  process.exit(drift.length ? 2 : 0);
})().catch((e) => {
  console.error(`mail-channel-check crashed: ${e.stack || e.message}`);
  process.exit(1);
});
