# n8n: Quota Reset Auto-Run (one-shot gate)

- **Workflow id:** `ardWIfcbe5TwkMm8` · **active:** true · created 2026-07-13
- **Credential:** `QRA Header Auth` (`t6G41mSyUrqqreHR`, httpHeaderAuth, header `X-QRA-Token`) on all 3 webhooks
- **Project:** work/quota-reset-autorun (one-off, not a numbered automation)
- **Export:** `workflow.json` (this dir), refreshed from the live instance 2026-07-13

The gate authority for the one-shot auto-run. Holds `fire_at` + `prompt` + `consumed` in workflow
static data (`$getWorkflowStaticData('global')`); the ThinkPad poller reads the gate and executes.

## Three webhook chains (share static data)
| Endpoint | Method | Chain | Purpose |
|---|---|---|---|
| `/webhook/qra-arm` | POST | Arm Webhook -> Set Arm State -> Arm Response | Sets `fire_at`, `prompt`, `consumed=false`, `run_id`. Needs `{fire_at (ISO), prompt}`. |
| `/webhook/qra-gate` | GET | Gate Webhook -> Compute Go -> Gate Response | Returns `{go, prompt, run_id, fire_at, consumed, now}`. `go = fire_at set AND !consumed AND now>=fire_at`. |
| `/webhook/qra-result` | POST | Result Webhook -> Mark Consumed -> Result Response | Flips `consumed=true`, records `last_status` + `completed_at`. |

All three require header `X-QRA-Token`; missing/wrong -> 403.

## Static data keys
`fire_at` (ISO), `prompt`, `consumed` (bool), `run_id`, `armed_at`, `last_status`, `last_output_chars`,
`completed_at`. Persist only after successful production executions (workflow is active).

## Notes
- Multi-trigger single workflow: three Webhook triggers, each with its own Respond to Webhook
  (`responseMode: responseNode`).
- One-shot guard is server-side (`consumed`) + laptop-side (task self-removes + `run.lock`).
- Inert until armed: an unarmed gate returns `go:false` (verified). Disarm = mark consumed.
