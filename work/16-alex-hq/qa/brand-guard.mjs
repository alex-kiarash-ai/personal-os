/*
 * brand-guard.mjs - Alex HQ brand & layout regression guard (Item 4 of the AI-guide upgrade plan).
 *
 * WHY NOT A PIXEL DIFF (the honest ground truth, learned by running it):
 * HQ renders private numbers AND private notes, from TWO dynamic sources - the server-side
 * Summary/Inbox (env-gated remote fetch) and the client-fetched /data/*.json (all gitignored, real
 * data). A masked pixel baseline of that page (a) risks leaking a private note the mask missed and
 * (b) false-fails every day the content changes. A robust pixel diff would need a full synthetic
 * fixture server for BOTH sources (a real sub-project, schema-drift risk) - deferred as Phase 2.
 *
 * So this guard tests the BRAND and LAYOUT directly, via computed styles and structure, which are
 * CONTENT-INDEPENDENT: it never screenshots private data, it can't leak, and it is stable run to run
 * while still catching a real styling regression (a broken canvas color, a swapped font, an accent
 * explosion, a collapsed grid, a missing logo). It achieves the plan's goal ("catch a styling /
 * brand / layout regression") the robust way for THIS app.
 *
 * RUN (from the app dir so puppeteer-core resolves; local build on :3000):
 *   cd work/16-alex-hq/app && npm start &
 *   node ../qa/brand-guard.mjs
 * Exit 0 = PASS, 1 = a brand/layout invariant broke. Wired into the #16 deploy Close-Out (advisory).
 *
 * Expected values are calibrated from the known-good render + brand/config/color-system.md. If the
 * brand law changes on purpose, update EXPECT here (that is the "accept the new look" step).
 */
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const require = createRequire(path.join(REPO, "work/16-alex-hq/app/package.json"));
const puppeteer = require("puppeteer-core");

const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.HQ_URL || "http://localhost:3000";

// Brand law (brand/config/color-system.md + the HQ instrument-surface deviation, brand-config.md).
const EXPECT = {
  canvasBg: "rgb(0, 18, 25)",        // Ink Black #001219
  kickerFont: "Chakra Petch",         // display / kicker WORDS
  numeralFont: "Plex Mono",           // all data numerals (IBM Plex Mono)
  accentOrange: "rgb(238, 155, 0)",   // Golden Orange #ee9b00, the ONE accent
  accentMax: 40,                       // one-accent law: sparse, never an explosion (calibrated)
  minTiles: 4,
};

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, gridCols: 1 },
  { name: "desktop", width: 1440, height: 900, gridColsMin: 2 },
];

async function probe(page, vp) {
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector(".tile", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1200));
  return page.evaluate((ORANGE) => {
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const first = (sel) => document.querySelector(sel);
    let accent = 0;
    for (const el of document.querySelectorAll("*")) {
      const c = getComputedStyle(el);
      if (c.color === ORANGE || c.backgroundColor === ORANGE || c.borderTopColor === ORANGE ||
          c.borderLeftColor === ORANGE || c.fill === ORANGE) accent++;
    }
    const contentGrids = [...document.querySelectorAll("section")]
      .map((s) => getComputedStyle(s).gridTemplateColumns)
      .filter((c) => c && c !== "none")
      .map((c) => c.split(" ").length);
    return {
      bodyBg: cs(document.body).backgroundColor,
      htmlBg: cs(document.documentElement).backgroundColor,
      kickerFont: (cs(first(".kicker"))?.fontFamily) || null,
      // data numerals are Plex Mono (.big / .accent-num / .num-display); NOT .tabular-nums, which
      // also matches the header age-stamp that renders Plex Sans with tabular figures by design.
      numeralFont: (cs(first(".big"))?.fontFamily) || null,
      logoOk: !!(first('img[alt="ALEX"]') && first('img[alt="ALEX"]').naturalWidth > 0),
      tileCount: document.querySelectorAll(".tile").length,
      maxGridCols: contentGrids.length ? Math.max(...contentGrids) : 0,
      accentCount: accent,
    };
  }, EXPECT.accentOrange);
}

function checkViewport(vp, p, fails) {
  const add = (ok, msg) => { if (!ok) fails.push(`[${vp.name}] ${msg}`); };
  add(p.bodyBg === EXPECT.canvasBg || p.htmlBg === EXPECT.canvasBg,
    `canvas bg not Ink Black ${EXPECT.canvasBg} (body=${p.bodyBg}, html=${p.htmlBg})`);
  add((p.kickerFont || "").includes(EXPECT.kickerFont),
    `kicker font not ${EXPECT.kickerFont} (got ${p.kickerFont})`);
  add((p.numeralFont || "").includes(EXPECT.numeralFont),
    `numeral font not ${EXPECT.numeralFont} (got ${p.numeralFont})`);
  add(p.logoOk, `ALEX logo missing or not loaded`);
  add(p.tileCount >= EXPECT.minTiles, `too few tiles (${p.tileCount} < ${EXPECT.minTiles})`);
  add(p.accentCount >= 1 && p.accentCount <= EXPECT.accentMax,
    `accent-law: golden-orange count ${p.accentCount} outside [1, ${EXPECT.accentMax}]`);
  if (vp.gridCols) add(p.maxGridCols === vp.gridCols, `grid should be ${vp.gridCols}-col, got ${p.maxGridCols}`);
  if (vp.gridColsMin) add(p.maxGridCols >= vp.gridColsMin, `grid should be >=${vp.gridColsMin}-col, got ${p.maxGridCols}`);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--no-sandbox", "--force-device-scale-factor=1", "--hide-scrollbars"],
  });
  const fails = [];
  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage();
      const p = await probe(page, vp);
      console.log(`[${vp.name}] bg=${p.bodyBg} kicker="${(p.kickerFont||'').split(',')[0]}" ` +
        `numeral="${(p.numeralFont||'').split(',')[0]}" logo=${p.logoOk} tiles=${p.tileCount} ` +
        `grid=${p.maxGridCols}col accent=${p.accentCount}`);
      checkViewport(vp, p, fails);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (fails.length) {
    console.error("\nbrand-guard: FAIL\n  " + fails.join("\n  "));
    process.exit(1);
  }
  console.log("\nbrand-guard: PASS - brand & layout invariants hold at both viewports.");
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
