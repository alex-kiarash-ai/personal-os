/*
 * brand-guard.mjs - Alex HQ brand & layout regression guard (Item 4 of the AI-guide upgrade plan;
 * rewritten 2026-07-29 for the light-default two-theme reskin).
 *
 * WHY NOT A PIXEL DIFF (the honest ground truth, learned by running it):
 * HQ renders private numbers AND private notes, from TWO dynamic sources - the server-side
 * Summary/Inbox (env-gated remote fetch) and the client-fetched /data/*.json (all gitignored, real
 * data). A masked pixel baseline of that page (a) risks leaking a private note the mask missed and
 * (b) false-fails every day the content changes. A robust pixel diff would need a full synthetic
 * fixture server for BOTH sources (a real sub-project, schema-drift risk) - deferred as Phase 2.
 *
 * So this guard tests the BRAND and LAYOUT directly, via computed styles and structure, which are
 * CONTENT-INDEPENDENT: it never screenshots private data, it can't leak, and it is stable run to
 * run while still catching a real styling regression (a broken canvas color, a swapped font, an
 * accent explosion, a collapsed grid, a missing logo, a flattened luminance ladder).
 *
 * TWO THEMES since 2026-07-29 (defaults reversed same day, Shaheen: "Go back to the same
 * colors"): DARK is the default canvas (Ink Black) and the measured light theme stays reachable
 * behind the toggle. The guard probes BOTH at both viewports (4 probes), selecting the theme the
 * way the real toggle does - localStorage("hq-theme") - so it also exercises the pre-paint theme
 * script. A wrong default (page opening light with no stored preference) fails the dark probe's
 * canvas assertion.
 *
 * RUN (from the app dir so puppeteer-core resolves; local build on :3000):
 *   cd work/16-alex-hq/app && npm start &
 *   node ../qa/brand-guard.mjs
 * Exit 0 = PASS, 1 = a brand/layout invariant broke. Wired into the #16 deploy Close-Out (advisory).
 *
 * Expected values are calibrated from the known-good render + brand/config/color-system.md +
 * the D6/D7 deviations in brand-config.md. If the brand law changes on purpose, update EXPECT
 * here (that is the "accept the new look" step).
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

// Brand law (color-system.md) + the HQ instrument-surface deviations (brand-config.md D6/D7).
const EXPECT = {
  kickerFont: "Oxanium", // display / kicker WORDS (D6 as replaced 2026-07-29)
  numeralFont: "Martian Mono", // all data numerals (D6 as replaced 2026-07-29)
  accentOrange: "rgb(238, 155, 0)", // Golden Orange #ee9b00, the ONE accent
  accentMax: 40, // one-accent law: sparse, never an explosion (calibrated)
  minTiles: 4,
  /* Per-theme canvas + luminance ladder. The ladder is the R2-4 invariant, held in BOTH themes:
     healthy faces read BRIGHTER than alarm faces, and flattening it in either direction is a
     brand regression, not cosmetic drift. Values are the relative luminance (0-255 weighted) of
     the DECLARED face tokens (--card / --elev), not sampled pixels - the ladder is made of those
     two tokens, so testing them is testing the thing itself, content-independent.
     Light reference: --card #ffffff = 255.0, --elev #fff5e1 (Warm Cream) = 245.7, gap 9.3.
     Dark reference: --card rgba(0,53,66,.6) = 42.7 (token channels), --elev #00232e = 28.4. */
  themes: {
    dark: {
      storage: null, // nothing stored = the DEFAULT path; dark must win on a fresh open
      // (Shaheen 2026-07-29 after the light renders: "Go back to the same colors")
      canvasBg: "rgb(0, 18, 25)", // Ink Black #001219 (the canvas identity)
      dataTheme: "dark",
      healthyFaceMinLuma: 38, // lifted healthy face ~#00303C (regression = the R2 lift reverted)
      alarmFaceMaxLuma: 29, // alarm face must STAY ~#00232e: Rusty burn numerals only clear it here (D7)
      ladderMinGap: 8,
    },
    light: {
      storage: "light", // the toggle's persisted choice
      canvasBg: "rgb(255, 255, 255)", // law §3: white 60% foundation
      dataTheme: "light",
      healthyFaceMinLuma: 250,
      alarmFaceMaxLuma: 248,
      ladderMinGap: 6,
    },
  },
};

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, gridCols: 1 },
  { name: "desktop", width: 1440, height: 900, gridColsMin: 2 },
];

async function probe(browser, vp, themeName, themeCfg) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((stored) => {
    try {
      if (stored) localStorage.setItem("hq-theme", stored);
      else localStorage.removeItem("hq-theme");
    } catch {}
  }, themeCfg.storage);
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector(".tile", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1200));
  const p = await page.evaluate((ORANGE) => {
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
    const luma = (css) => {
      const rgbm = css.match(/rgba?\(([^)]+)\)/);
      if (rgbm) {
        const [r, g, b] = rgbm[1].split(",").map((n) => parseFloat(n));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      // Lightning CSS minifies #ffffff -> #fff in the production bundle: accept shorthand too
      const hexm = css.match(/#([0-9a-f]{3,8})/i);
      if (!hexm) return null;
      let h = hexm[1];
      if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const rootCs = getComputedStyle(document.documentElement);
    return {
      // no attribute = the DARK default (reversed 2026-07-29, "go back to the same colors")
      dataTheme: document.documentElement.dataset.theme ?? "dark",
      bodyBg: cs(document.body).backgroundColor,
      htmlBg: cs(document.documentElement).backgroundColor,
      kickerFont: (cs(first(".kicker"))?.fontFamily) || null,
      // data numerals (.big); NOT .tabular-nums, which also matches body-font age stamps
      numeralFont: (cs(first(".big"))?.fontFamily) || null,
      logoOk: !!(first('img[alt="ALEX"]') && first('img[alt="ALEX"]').naturalWidth > 0),
      tileCount: document.querySelectorAll(".tile").length,
      maxGridCols: contentGrids.length ? Math.max(...contentGrids) : 0,
      accentCount: accent,
      healthyFaceLuma: luma(rootCs.getPropertyValue("--card").trim()),
      alarmFaceLuma: luma(rootCs.getPropertyValue("--elev").trim()),
      webglBrain: !!first(".brain-wrap canvas"),
    };
  }, EXPECT.accentOrange);
  await page.close();
  return p;
}

function check(vp, themeName, themeCfg, p, fails) {
  const tag = `[${themeName} ${vp.name}]`;
  const add = (ok, msg) => { if (!ok) fails.push(`${tag} ${msg}`); };
  add(p.dataTheme === themeCfg.dataTheme,
    `theme did not apply (expected ${themeCfg.dataTheme}, got ${p.dataTheme}) - default/toggle path broken`);
  add(p.bodyBg === themeCfg.canvasBg || p.htmlBg === themeCfg.canvasBg,
    `canvas not ${themeCfg.canvasBg} (body=${p.bodyBg}, html=${p.htmlBg})` +
    (themeName === "dark" ? " - the page must OPEN dark by default (nothing stored)" : ""));
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
  // the luminance ladder: healthy above alarm in this theme's band, never collapsing
  add(p.healthyFaceLuma != null && p.healthyFaceLuma >= themeCfg.healthyFaceMinLuma,
    `healthy tile face out of band (luma ${p.healthyFaceLuma?.toFixed(1)}, need >=${themeCfg.healthyFaceMinLuma})`);
  add(p.alarmFaceLuma != null && p.alarmFaceLuma <= themeCfg.alarmFaceMaxLuma,
    `alarm tile face out of band (luma ${p.alarmFaceLuma?.toFixed(1)}, need <=${themeCfg.alarmFaceMaxLuma})`);
  add(p.healthyFaceLuma != null && p.alarmFaceLuma != null &&
    p.healthyFaceLuma - p.alarmFaceLuma >= themeCfg.ladderMinGap,
    `luminance ladder collapsed (healthy ${p.healthyFaceLuma?.toFixed(1)} vs alarm ${p.alarmFaceLuma?.toFixed(1)}) - state stops reading as brightness`);
  // the hybrid-3D contract: the ONE WebGL surface exists (the Brain card)
  add(p.webglBrain, `no WebGL canvas inside .brain-wrap - the 3D brain did not mount`);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--no-sandbox", "--force-device-scale-factor=1", "--hide-scrollbars", "--enable-unsafe-swiftshader"],
  });
  const fails = [];
  try {
    for (const [themeName, themeCfg] of Object.entries(EXPECT.themes)) {
      for (const vp of VIEWPORTS) {
        const p = await probe(browser, vp, themeName, themeCfg);
        console.log(`[${themeName} ${vp.name}] theme=${p.dataTheme} bg=${p.bodyBg} ` +
          `kicker="${(p.kickerFont||'').split(',')[0]}" numeral="${(p.numeralFont||'').split(',')[0]}" ` +
          `logo=${p.logoOk} tiles=${p.tileCount} grid=${p.maxGridCols}col accent=${p.accentCount} ` +
          `ladder=${p.healthyFaceLuma?.toFixed(1)}/${p.alarmFaceLuma?.toFixed(1)} webgl=${p.webglBrain}`);
        check(vp, themeName, themeCfg, p, fails);
      }
    }
  } finally {
    await browser.close();
  }
  if (fails.length) {
    console.error("\nbrand-guard: FAIL\n  " + fails.join("\n  "));
    process.exit(1);
  }
  console.log("\nbrand-guard: PASS - brand & layout invariants hold at both viewports in both themes.");
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
