# Application Engine (MCP) - MCP Server Trigger measurement runbook

Repointed measurement for Alex AI Radar decision #1 (n8n native MCP). Origin + correction: [[research/n8n-native-mcp-concept]], [[projects/alex-ai-radar/decisions]] #5. The original "refactor the application-engine's Notion ops" plan was void (this pipeline has no Notion ops - it writes Sheets + Drive). This is the real measurement: expose the pipeline **as** an MCP server his own Claude can call, via the **MCP Server Trigger** node.

## Non-negotiable safety
- **A NEW, SEPARATE workflow.** The live "Application Engine" (daily 07:00 Stockholm cron) is **not touched, not duplicated-then-mutated, not paused.**
- **Read-only first tool.** `pipeline_status` only READS the Google Sheet. No Bright Data call, no Claude tokens, no writes. Zero incremental cost.
- **Bearer auth on the endpoint** from the first minute. The MCP URL is public via Caddy TLS, so it is never left open.

## Preconditions (verify, do not assume)
1. n8n version `>= 2.22` (native MCP nodes GA). On `n8nio/n8n:latest` this holds. Check: `docker exec $(docker ps -qf name=n8n) n8n --version`.
2. `MCP Server Trigger` is a **native/core** node (`@n8n/n8n-nodes-langchain.mcpTrigger`). No community node, no static Docker image, no runtime NPM. The static-image caveat in the concept brief applies only to community nodes.
3. Caddy already reverse-proxies all of n8n (127.0.0.1:5678 → TLS). The MCP endpoint rides that automatically - **no Caddyfile change.**
4. Existing credential `Google Sheets account` (id `UhK77WK48hRv85bo`) is reused. No new credential except the MCP Bearer token.
5. n8n base URL = `N8N_EDITOR_BASE_URL` in `/opt/n8n/.env` (same domain Caddy serves). Referenced below as `<N8N_BASE_URL>`.

## Build - two workflows

### Workflow B: "MCP Tool - pipeline_status" (the worker)
The logic lives here so the tool stays a thin wrapper.
1. **Execute Workflow Trigger** (input: none needed for v1).
2. **Google Sheets → Read rows** - spreadsheet `19puwN6wxFHI7iICrdafiFn1Diqq7qJTe5-5r0Y2XQFY` (Job Search Pipeline), tab `run_log`. Credential `Google Sheets account`.
3. **Code (aggregate today)** - filter rows where `date` == today (Europe/Stockholm), return one JSON object:
   ```
   { date, jobs_scored, drafted, needs_review, total_cost, currency: "USD",
     last_run_status, note }
   ```
   (jobs_scored = rows today; drafted = rows with a `drive_folder_url`; needs_review = count from the `needs_review` tab for today; total_cost = sum of `total_cost`.)
4. Returns that object to the caller.

### Workflow A: "Application Engine (MCP)" (the server)
1. **MCP Server Trigger** (`@n8n/n8n-nodes-langchain.mcpTrigger`)
   - Path: `app-engine` (production URL becomes `<N8N_BASE_URL>/mcp/app-engine`). Transport depends on the node's **typeVersion**: v1 = legacy SSE only (at `/mcp/app-engine/sse`), v2 = streamable HTTP (at `/mcp/app-engine`, the /sse route disappears). **Live build is typeVersion 2 / streamable HTTP since 2026-07-02.**
   - Authentication: **Bearer**. Create credential "MCP App-Engine Bearer" with a long random token. Store the token in `/opt/n8n/.env` too, for the record, NOT in the vault or this repo.
2. **Call n8n Workflow Tool** (attached to the MCP Server Trigger's `ai_tool` input)
   - Name the tool `pipeline_status`.
   - Description (this is what Claude reads to decide when to call it): `"Get today's job-application pipeline status: jobs scored, drafts written, items needing review, and total cost."`
   - Workflow: **Workflow B** above.
3. Activate Workflow A. (Workflow B does not need activating; it runs when called.)

## Register with his Claude (client side)
From the machine running Claude Code:
```
claude mcp add --transport http app-engine <N8N_BASE_URL>/mcp/app-engine \
  --header "Authorization: Bearer <token>"
```
(Cursor: add the same URL + header to `mcp.json`. The old `--transport sse` + `/mcp/app-engine/sse` form only applies to a typeVersion-1 trigger; the live build is v2/streamable since 2026-07-02.)

## Test (the measurement)
Ask Claude: **"What's my job pipeline status today?"**
- PASS = Claude calls `pipeline_status`, n8n reads the Sheet, real numbers come back.
- Capture the round-trip in the outputs folder for the portfolio clip.

## What we measure (decision-data for expand vs park)
1. **Does the round-trip work?** Claude → n8n MCP → Sheet → answer. Y/N.
2. **Wiring cost to expose one capability.** 3 nodes + 1 credential + 1 client line. Compare to standing up a bespoke API + auth for the same thing.
3. **Maintenance surface.** Auth rotation, endpoint stability on `:latest` pulls, tool-description drift.
4. **Verdict gate.** Clean + genuinely useful → expand to `search_jobs` (parameterized city/keyword slice) and `needs_review_list`, then screen-record for the Building Alex episode + Alex-product demo. Flaky or pointless → park, keep as portfolio-research.

## How this lands on the box (corrected 2026-07-01)
Alex builds it **directly via the n8n public REST API** - same access `work/14/config/*.js` already uses. No Chrome, no manual import.
- Base `https://n8n.shaheenkiarash.com/api/v1`, key `work/03-application-engine/config/n8n-api-key.txt` as `X-N8N-API-KEY`.
- `POST /workflows` (create) → `POST /workflows/{id}/activate` (activate the server workflow).
- **Live cron `9XuIEfxS71DEetVR` ("Application Engine", active) is never read-modify-written.** The two new workflows are additive.
- Only thing that leaves Alex's hands: register the resulting MCP URL + Bearer token in the Claude/Cursor MCP config (client side), then the test call.

## Built 2026-07-01 (LIVE, proven end-to-end)
Built entirely via the REST API. Round-trip validated with real run_log data (2 jobs / 2 drafted / $0.1259 on 2026-07-01).

**Live objects on the box:**
- Workflow A (server) `CnhvoIVLSc6cUQZG` "Application Engine (MCP)" - **active**. MCP Server Trigger (`@n8n/n8n-nodes-langchain.mcpTrigger`, path `app-engine`, bearerAuth) + **3** `toolWorkflow` tools.
- Worker `k4p4TUoGrAuFt3Gg` "MCP Tool - pipeline_status" - active. run_log → today's jobs/drafted/cost.
- Worker `K4OGYfB5g77VU2Jr` "MCP Tool - search_jobs" - active. Reads run_log, filters by JSON input `{"location","keyword","min_fit"}`. **Read-only over already-scored history, NO Bright Data crawl / no spend** (deliberate: a Claude-callable tool must never silently spend; a live paid search would be a separate spend-gated tool).
- Worker `0AAbgjjezs16BCCX` "MCP Tool - needs_review_list" - active. Reads `needs_review` tab, JSON input `{"limit"}`, newest first.
- All 4 workflows Google-Sheets-read via existing cred `UhK77WK48hRv85bo`.
- Credential `S7Q1jSraHTmQXk29` "MCP App-Engine Bearer (rotated)" (`httpBearerAuth`). Rotated 2026-07-01 21:50 (prior `FZCprWWfZby1Vyw5` deleted after its token leaked into a chat transcript; old token verified 403). **Token is NOT in the repo/vault** - held with Shaheen + belongs in `/opt/n8n/.env`. To rotate again: create a fresh `httpBearerAuth` cred (needs `allowedDomains`), rebind the MCP Server Trigger node, delete the old cred.
- Endpoint: **streamable HTTP** `https://n8n.shaheenkiarash.com/mcp/app-engine` (since 2026-07-02; the original build was legacy SSE at `/mcp/app-engine/sse`, see "Transport upgraded" below - that route is now gone).

**Tool input shape:** `search_jobs` + `needs_review_list` now carry a **structured input schema** (`specifyInputSchema: true`, `schemaType: manual`, `inputSchema` JSON), so `tools/list` advertises real params: `search_jobs` → `location`/`keyword`/`min_fit`, `needs_review_list` → `limit`. The workers still accept a JSON string or a bare word as a fallback. (Default MCP tool input is a single `input` STRING; passing a raw number 400s - the schema fixes that.)

**Register in his Claude (streamable HTTP, current):**
```
claude mcp add --transport http app-engine \
  https://n8n.shaheenkiarash.com/mcp/app-engine \
  --header "Authorization: Bearer <token>"
```

**Gotchas banked (real, learned building this):**
- The worker sub-workflow MUST be **active**, or the tool call returns `"Workflow is not active and cannot be executed."`
- `httpBearerAuth` credential create requires an `allowedDomains` field (`''` = unrestricted), else 400.
- Auth gate confirmed: request without the bearer → **403** (verified again post-transport-switch, garbage token also 403).
- **Transport is decided by the trigger node's typeVersion, not the n8n build** (CORRECTED 2026-07-02; the old line here blamed the n8n build). typeVersion 1 = legacy SSE (`/sse` route, `messages?sessionId=` POST-back); typeVersion 2 = streamable HTTP at the bare `/mcp/{path}` URL, and the `/sse` route disappears. The 2026-07-01 build defaulted to typeVersion 1 because the API-created node specified none.

## Transport upgraded 2026-07-02 (legacy SSE → streamable HTTP)
Origin: Alex AI Radar run-4 deep-dive on the MCP 2026-07-28 spec ([[research/mcp-spec-v2-stateless-concept]]) probed the box and caught the friction-#4 misdiagnosis. Executed on Shaheen's yes:
- Box inventory (read-only, via SSH + REST): n8n **2.21.7** (image pulled 2026-05-21, Postgres 16), McpTrigger supports typeVersion **[1, 1.1, 2]**. The live trigger was v1.
- Change: PUT workflow `CnhvoIVLSc6cUQZG` with the trigger at **typeVersion 2** (only field changed). Backup first: `config/backup-pre-typebump-1783001244.json`. Workflow stayed active; live crons + 3 workers untouched and verified active after.
- Probes after: `POST /mcp/app-engine` → **403** (route live, auth gate enforcing; was 404). `GET /mcp/app-engine/sse` → **404** (legacy route gone). Garbage bearer → 403.
- **Rollback:** PUT the backup JSON back (restores typeVersion 1 / SSE) - one API call.
- Remaining (needs the token, held with Shaheen): register in Claude with the http command above, then an authenticated `tools/list` + `pipeline_status` round-trip. NOTE: the token is NOT in `/opt/n8n/.env` (checked 2026-07-02, key names only) - the "belongs in .env" line above never happened.

**Measurement verdict:** PROVEN + EXPANDED to 3 tools, all returning real data (search_jobs → 20 scored jobs; needs_review_list → 113-row queue). Cost to expose a capability: ~1 small worker + 1 tool node each. Ready to screen-record for the Building Alex episode + Alex-product demo.

**Demo queries (ask your Claude once the MCP server is registered):**
- "What's my job pipeline status today?" → `pipeline_status`
- "Search my scored jobs in Dubai" → `search_jobs {"location":"Dubai"}`
- "Which drafted jobs are above fit 75?" → `search_jobs {"min_fit":75}`
- "What's in my needs-review queue?" → `needs_review_list {"limit":10}`
