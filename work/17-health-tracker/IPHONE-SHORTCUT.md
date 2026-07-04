# iPhone Shortcut — "Alex Health Push" (iOS 26.5.1, live-rebuilt 2026-07-04)

The last mile: a free, native iOS Shortcut that reads today's steps + last night's sleep from Health and
POSTs them to Alex's box once a day at 23:59. Everything server-side is already live and tested.

**This version was rebuilt WITH Shaheen on his actual phone**, so every action name and gotcha below is real,
not guessed. Follow it top to bottom.

- **Sends to:** `https://n8n.shaheenkiarash.com/webhook/alex-health-ingest`
- **Auth header:** `X-Alex-Token` = the value in `work/16-alex-hq/config/alex-hq-token.txt` (paste it into the
  Shortcut once, it lives only on your phone; never share/export the Shortcut, it carries the token).
- **What n8n does:** computes the Alex Sleep Score, writes one row for today, the brief + HQ read it.

---

## THE THREE THINGS THAT TRIPPED US UP (read first, 30 seconds)

1. **One Shortcut, many lines.** A *Shortcut* is one recipe card ("Alex Health Push"). *Actions* are lines
   stacked inside it. Add every line from the **search bar at the BOTTOM of the open shortcut** — never go
   back to the gallery and make a new shortcut. You want exactly ONE shortcut.

2. **Sleep durations come out in SECONDS.** Calculate Statistics on sleep gives seconds (e.g. 1883). The
   server wants minutes, so every sleep block ends with a **Calculate ÷ 60** step (1883 ÷ 60 = 31 min). If a
   sleep number looks like ~1000–30000, you forgot the ÷ 60.

3. **Use "is today," not "is in the last 1 day."** In Shortcuts "is in the last 1 day" means "since the START
   of yesterday," which scoops up **two nights** and adds them (we saw 56 + 31 = 87). **"is today" isolates a
   single night.** Every date filter in this build is **is today**.

---

## The build

Open **Alex Health Push** and swipe away anything already in it so it's blank. Then add these lines in order,
all from the bottom search bar. Only two patterns repeat:

- **Pattern A (a count):** Find Health Samples → Calculate Statistics (**Sum**) → Set Variable
- **Pattern B (sleep minutes):** Find Health Samples → Calculate Statistics (**Sum of Duration**) → Calculate (**÷ 60**) → Set Variable

### Block 1 — Today's date (2 lines)
1. **Format Date** → Date = **Current Date**, Format = **Custom** = `yyyy-MM-dd`
2. **Set Variable** → **Today**

### Block 2 — Steps (Pattern A, 3 lines)
3. **Find Health Samples** → Sample Type **Steps** · filter **Start Date is today** · filter **Source is iPhone**
4. **Calculate Statistics** → **Sum** (if it asks "of ___", leave the default)
5. **Set Variable** → **Steps**

### Block 3 — Deep (Pattern B, 4 lines)
6. **Find Health Samples** → Sample Type **Sleep** · filter **Value is deep** · filter **Start Date is today**
7. **Calculate Statistics** → **Sum of Duration**
8. **Calculate** → change **+** to **÷**, number **60**
9. **Set Variable** → **DeepMin**

### Block 4 — REM (Pattern B, 4 lines)
10. **Find Health Samples** → Sleep · **Value is REM** · **Start Date is today**
11. **Calculate Statistics** → **Sum of Duration**
12. **Calculate** → **÷ 60**
13. **Set Variable** → **RemMin**

### Block 5 — Core (Pattern B, 4 lines)
14. **Find Health Samples** → Sleep · **Value is Core** · **Start Date is today**
15. **Calculate Statistics** → **Sum of Duration**
16. **Calculate** → **÷ 60**
17. **Set Variable** → **CoreMin**

### Block 6 — In Bed (Pattern B, 4 lines)
18. **Find Health Samples** → Sleep · **Value is In Bed** · **Start Date is today**
19. **Calculate Statistics** → **Sum of Duration**
20. **Calculate** → **÷ 60**
21. **Set Variable** → **InBedMin**

### Block 7 — Awakenings (count, 3 lines)
22. **Find Health Samples** → Sleep · **Value is Awake** · **Start Date is today**
23. **Calculate Statistics** → **Count** (not Sum — we want how many times, not minutes)
24. **Set Variable** → **Wakes**

### Block 8 — Total asleep (2 lines)
25. **Calculate Expression** → insert **DeepMin + RemMin + CoreMin** (the three chips, `+` between them).
    *(No "Calculate Expression" action? Use two plain Calculate lines: DeepMin + RemMin, then that result + CoreMin.)*
26. **Set Variable** → **AsleepMin**

### Block 9 — Build the payload (1 line)
27. **Text** → type this exactly, replacing each **⟨Name⟩** with the matching variable chip. Quotes stay
    around the date; numbers have NO quotes:
```
{"days":[{"date":"⟨Today⟩","steps":⟨Steps⟩,"deep_min":⟨DeepMin⟩,"rem_min":⟨RemMin⟩,"core_min":⟨CoreMin⟩,"inbed_min":⟨InBedMin⟩,"asleep_min":⟨AsleepMin⟩,"awakenings":⟨Wakes⟩,"source":"phone"}]}
```

### Block 10 — Send it (2 lines)
28. **Get Contents of URL**
    - URL: `https://n8n.shaheenkiarash.com/webhook/alex-health-ingest`
    - **Show More** → Method **POST**
    - Headers → add two: `X-Alex-Token` = *(paste token from `work/16-alex-hq/config/alex-hq-token.txt`)*,
      and `Content-Type` = `application/json`
    - Request Body: **File** → pick the **Text** from line 27
      *(Text-as-body + the application/json header is what makes n8n parse it. Do NOT use the "JSON" body
      builder — that nested-dictionary path is the trap we avoided.)*
29. **Show Notification** → content = the **Contents of URL** result

---

## Test (do the moment it's built)
Tap **▶**. The notification should read **`{"ok":true,"count":1}`**.
- `count:1` = the row landed. Good.
- `count:0` or an error = a typo in the Text (line 27) — check every quote and comma.
- `403` = the `X-Alex-Token` header is wrong or missing.
- nothing / hang = URL typo or no network.

Then sanity-check against the Health app:
- **DeepMin** ≈ Health's deep minutes for last night. (Real reference from 2026-07-04: 3rd = 56 min, 4th = 31 min.)
- **Steps** ≈ today's step count. A single source (iPhone) reads a bit UNDER Health's shown total, because
  Health secretly merges iPhone + Watch and the phone can't. Close and consistent is the goal.
- If ONE sleep stage comes back 0, its Value word is off. Try **contains** instead of **is**, or check the
  spelling (deep / REM / Core / In Bed / Awake). In Bed and Awake are optional — if they won't read, the score
  still computes from duration + deep + REM, just slightly less precise.

## Schedule it (once the test passes)
Shortcuts → **Automation** tab → **+** → **Time of Day** → **23:59** → **Daily** → **Run Immediately**
(turn **Ask Before Running OFF**) → pick **Alex Health Push**.
- **Why 23:59:** the day's steps are essentially complete, and "is today" still grabs last night's sleep.
  One run, both metrics, maximum accuracy.
- iOS sometimes skips a time automation on a locked phone; the pipeline is idempotent (a missed day just shows
  the last good one). If skips annoy you, add an identical **00:30** catch-up automation.

## How the data is dated (so nothing looks off later)
Both steps and sleep go in **one row dated today**. Steps = the day that's ending; sleep = the night you woke
from this morning. Next morning's 08:00 brief reads that row and calls it "yesterday." That's why the reply is
`count:1` (one combined row), not two.

## Notes
- **Sleep source:** only the Watch tracks sleep (worn at night), so sleep readers need NO source filter. Steps
  come from the phone (Watch charges by day), so the steps reader DOES filter Source is iPhone.
- **Token safety:** HTTPS only, token scoped to this one webhook and rotatable. Never share/export the Shortcut.
