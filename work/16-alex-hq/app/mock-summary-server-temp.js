// TEMP mock: proxies the real HQ summary but forces human-actions open_count = 0, so a local app
// instance pointed here renders the EMPTY-QUEUE state (strip absent). Also serves an empty inbox
// so the notes card is clean. Delete after QA. NOT deployed, NOT committed.
const http = require("http");
const fs = require("fs");

const REAL = "https://n8n.shaheenkiarash.com/webhook/alex-hq-summary";
// read the token from .env.local so it never passes through argv/stdout
const env = fs.readFileSync(".env.local", "utf8").split("\n").reduce((a, l) => {
  const i = l.indexOf("=");
  if (i > 0) a[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  return a;
}, {});
const TOKEN = env.ALEX_HQ_TOKEN;

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  // the app's getInbox() hits {base}/alex-inbox — serve inbox rows in each row-state so the notes
  // card shows: a voice row filed (mic glyph + "filed → destination" + backfilled transcript),
  // a voice row still waiting ("saved · transcribes next touchpoint"), and a typed filed row.
  if (req.url.includes("alex-inbox")) {
    const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
    const recent = [
      { id: 501, note: "", source: "hq-voice", status: "new", filed_to: "", ts: iso(1), audio: "note-abc.m4a" },
      { id: 502, note: "Remind me to call the landlord about the boiler on Monday", source: "hq-voice", status: "filed", filed_to: "vault/me/todos.md", ts: iso: 40, audio: "note-xyz.m4a" },
      { id: 503, note: "Book dentist for the second week of August", source: "hq-typed", status: "filed", filed_to: "Google Calendar", ts: iso(120), audio: "" },
    ];
    res.end(JSON.stringify({ generated_at: new Date().toISOString(), count_new: 1, new: [recent[0]], recent }));
    return;
  }
  try {
    const r = await fetch(REAL, { headers: { "X-Alex-Token": TOKEN } });
    const j = await r.json();
    if (j.projects && j.projects["human-actions"]) {
      const ha = j.projects["human-actions"];
      if (ha.metrics && ha.metrics.open_count) {
        ha.metrics.open_count.value_num = 0;
        ha.metrics.open_count.status = "green";
        ha.metrics.open_count.headline = "";
      }
      ha.status = "green";
    }
    res.end(JSON.stringify(j));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(3210, () => console.log("mock summary server on http://localhost:3210"));
