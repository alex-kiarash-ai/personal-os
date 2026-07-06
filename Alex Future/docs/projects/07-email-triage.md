# 07 - Email Triage

## What it actually does
Three times a day (09:00, 13:00, 17:00) it reads the unread inbox and sorts every message into three piles: **Act Now**, **Read Later**, **Archive**. For the Act Now pile it pulls context on the sender (from the CRM and vault) and writes reply drafts in Shaheen's actual voice. Run interactively, Shaheen approves/edits/skips each draft and approved ones are staged in Gmail; run on schedule, drafts go to a file for later review. It never sends anything itself, and it learns: every edit Shaheen makes to a draft is harvested into his writing-style notes, so the next drafts sound more like him.

## Why it exists
The inbox is where hours disappear. Sorting is judgment a machine can do; the reply drafts turn "I'll answer that tonight" into "approve, tweak one word, send." The learning loop is the quiet point of the whole thing: the more it's corrected, the less it needs correcting - the voice corpus is an asset that compounds.

## Works together with
- **[Personal CRM](05-personal-crm.md)** - sender context in, relationship activity out.
- **[Morning Brief](02-morning-brief.md)** - the brief headlines the inbox; triage processes it.
- **soul.md** - reads the voice, feeds the "My Words" corpus through its edit-harvest.
- **[Alex HQ](16-alex-hq.md)** - pushes its run stats; collects dropped notes at each of its three daily touchpoints.
