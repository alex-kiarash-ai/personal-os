# /port-to-kit - Carry an Alex improvement into the Alex Kit

Take a change that landed here and deliver it to the two family installs, adapted rather than
copied. Runs in `Desktop/alex-kit`, a SIBLING of this repo, never nested.

## Refuse to run without a named change

Like `/migrate`, this does nothing on a vague ask. Require: **what changed** (a dated entry, a
commit, a file, a rule) and **why it might belong there**. "Sync the kit" is not a target. If the
user has not named one, ask once and stop.

## Why this is not a sync

The Kit is a different system, not a copy of this one. It ships 8 projects, not 33. It has no n8n,
no remote box, no dashboard, no website. Its owners are two working translators, not one person
pivoting careers. A mechanical file sync would drag Shaheen's identity, his lanes and his
infrastructure into somebody else's system, which is the exact failure `scripts/clone-scrub-check.js`
exists to catch. So every change gets classified before anything is written.

## Step 1: the triage test

Four questions, in order. Answer them out loud in the run, one line each:

1. **Is it tied to a project the Kit does not ship?** (#03, #12, #14, #31/#32, HQ, radar, runway,
   the CV lanes.) If yes: either DROP it, or keep the underlying rule and cut every name. A rule
   that mentions a project they do not have is a promise to nothing.
2. **Does it need infrastructure the Kit lacks?** (n8n, the Hetzner box, Alex HQ, the website,
   Notion at scale.) If yes: DROP. Do not port a mechanism whose engine is absent.
3. **Does it name Shaheen, his voice, his family, his employer, or his lanes?** If yes: GENERALIZE.
   His ESL markers are his; theirs are theirs. Write the rule so it points at *the owner*.
4. **Is it a universal rule, gate, skill, or checker?** If yes: **PORT**.

Anything that survives 1 to 3 and answers yes to 4 goes across. Everything else gets a NOT PORTED
row with the reason, which is not a lesser outcome: a deliberate skip that nobody wrote down reads
as an oversight six months later.

## Step 2: pick the delivery half (this is the part that gets missed)

The Kit has **two** delivery routes and the change usually needs both.

| The change touches | Route | Reaches them by |
|---|---|---|
| Tracked files: skills, `CLAUDE.md`, `brand/config/*`, `docs/*`, `.claude/commands/*`, scripts | **git** | They double-click `Update-Alex.cmd` |
| `soul.md`, the vault, anything gitignored | **a migration** | `scripts/run-migrations.js`, called by `Update-Alex.cmd` step 6 |

**soul.md is gitignored on purpose** so whoever hosts the repo never sees their content. Git cannot
reach it. A voice-rule change with no migration silently does not arrive, and nothing will tell you.
If the change touches identity files, write `scripts/migrations/NNN-<name>.js` and follow the
contract in `scripts/run-migrations.js`: idempotent, back up only immediately before writing, verify
by read-back, restore on mismatch, and **if the expected anchor is missing, change nothing and say
so**. A declined migration stays pending and is never recorded as applied.

Also update `.claude/commands/setup.md` when the change is a voice or identity default, so a FUTURE
fresh install bakes it in and needs no migration at all.

## Step 3: apply, in the Kit

Write the adapted version. Never paste this repo's wording across without reading it for names,
project numbers and infrastructure. Skills install as DATA on the existing posture: read every byte,
run the banned-pattern gate, write to `.agents/skills/`, junction into `.claude/skills/`, hash into
`skills-lock.json`, and if the installed file gets a local scope guard, say so in the lock `note`
because the hash will differ from upstream by design.

## Step 4: verify before committing

Run in the Kit, and prove it on a clone rather than on a tree that already has the answer:

- `node scripts/clone-scrub-check.js` -> **CLEAN**. The load-bearing one. It proves no name, no dead
  hostname and no machine path rode along inside the ported text.
- `node scripts/validate-alex.js` -> G1-G4 + V1-V18 PASS (V2/V9/V14 warnings are normal on an
  uninstalled template checkout).
- `node scripts/facts-check.js` -> any count you moved is consistent.
- Skill counts: `.agents/skills` dirs == lock entries, unparked missing junctions == 0, disk hash
  == lock hash.
- **If you wrote a migration, test all four paths on a scratch copy:** applies correctly, is
  idempotent on a second run, uses its fallback anchor, and leaves the file BYTE-IDENTICAL with no
  backup written when the anchor is missing.
- `node scripts/generate-alex.js --only=docs` if you touched a generated doc. **Never pass
  `--only=scheduler` here:** it reaches `schtasks /create /f` and would register Kit jobs on this
  laptop.
- Commit, `git push origin main`, then **re-clone and confirm the pushed tree**, including that every
  file the change references actually exists in the clone.

## Step 5: record it, both sides

- `vault/projects/alex-kit/ported.md`: a dated row, or a NOT PORTED row with the reason.
- `vault/projects/alex-kit/status.md`, `vault/log.md`, and `vault/index.md` if anything structural moved.
- Tell the user the one thing they have to pass on: **double-click `Update-Alex.cmd`, once per
  machine.** No re-download, no re-install.

## What this command never does

It does not touch their machines, their `soul.md`, or their vault. It ships a template. Everything
after that is their double-click.
