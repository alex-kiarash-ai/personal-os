# /post-publish - Stage Approved Episodes (never posts)

Spec and HARD RULES: work/12-linkedin-series/CLAUDE.md. HARD GATE: only Notion Status=Approved can ever be staged. No LinkedIn API exists in this system. n8n stages, Shaheen posts.

## Flow (also what the n8n workflow does Tue/Thu 08:00)
1. Query Content Library for the oldest "Building Alex" row with Status=Approved.
2. None found on a slot day → report "no approved episode for tomorrow's slot" and stop.
3. Create Drive folder "Building Alex"/episode-NN-slug/ and upload: post.txt (the full page-body text, copy-paste ready) + the approved image.
4. Update the Notion row: Status=Staged + Drive link.
5. Shaheen posts manually at 08:30 and reports back ("posted" + URL) → set Status=Published + post URL, update plan.md and status.md.
6. Comment replies: draft ONLY when Shaheen asks, he sends.

## Ops duties
- Deploy/maintain the n8n workflow "LinkedIn Series" (after episode 1 approval; reuse the API push pattern from work/03-application-engine/config/push-nodash.js).
- Keep Morning Brief aware of slot days ("posting day: episode N staged in Drive").
- Post-run ingestion per work/12 CLAUDE.md.
- **Alex HQ metrics push** after any staging or published-report run (build #16 contract, work/16-alex-hq/CLAUDE.md). Never let a push failure fail the run; never print or log the token:
  `curl -s -m 10 -X POST https://n8n.shaheenkiarash.com/webhook/alex-push -H "Content-Type: application/json" -H "X-Alex-Token: $(cat work/16-alex-hq/config/alex-hq-token.txt)" -d '{"project":"linkedin-series","metric_key":"episodes_published","value_num":{published count},"value_text":"{n}/12","headline":"{latest state + next Tue/Thu slot}","status":"green"}' || true`
