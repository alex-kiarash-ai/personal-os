/*
 * render-shots.mjs - Alex HQ render harness (permanent tool, 2026-07-29).
 * Every design wave used to re-write this ad hoc; this is the reusable version.
 *
 * Shoots the LOCAL build (never production) at 390 + 1440 in BOTH themes, full page + first
 * fold, into a dated outputs folder. Steps the scroll so whileInView reveals fire (the shots2
 * lesson: an instant programmatic jump never triggers IntersectionObserver), dwells at the
 * bottom so the 3D brain settles, then returns to top before shooting.
 *
 * RUN (from the app dir so puppeteer-core resolves; local build on :3000):
 *   cd work/16-alex-hq/app && npm start &
 *   node ../qa/render-shots.mjs ../../../outputs/alex-hq/YYYY-MM-DD [prefix]
 * Theme selection rides localStorage("hq-theme") via evaluateOnNewDocument - the same switch
 * the in-app toggle persists, so the shot exercises the real theme path.
 */
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

/*
 * Downscale-at-capture (S1 Compiled Surfaces P2, 2026-08-16): full-page PNG shots were landing
 * 2-5MB each and the dated QA folders were a top disk-growth source (run-44 measurement). Every
 * shot now converts to a width-capped JPEG (max 1200px, q82) via ImageMagick and the PNG is
 * removed - these are human-review artifacts, nothing reads the .png path after the run.
 * Fail-open: no `magick` on PATH = keep the PNG and say so (a QA harness must never die over
 * an optimizer).
 */
function slim(pngPath) {
  const jpg = pngPath.replace(/\.png$/i, ".jpg");
  try {
    execFileSync("magick", [pngPath, "-resize", "1200>", "-strip", "-quality", "82", jpg], { stdio: "pipe" });
    fs.unlinkSync(pngPath);
    return jpg;
  } catch (e) {
    console.warn(`  (slim skipped for ${path.basename(pngPath)}: ${e.message.split("\n")[0]})`);
    return pngPath;
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, "../app/package.json"));
const puppeteer = require("puppeteer-core");

const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.HQ_URL || "http://localhost:3000";
const OUT = process.argv[2];
const PREFIX = process.argv[3] || "shot";
if (!OUT) {
  console.error("usage: node render-shots.mjs <out-dir> [prefix]");
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
];
const THEMES = ["light", "dark"];

async function settleScroll(page) {
  // step-scroll so IntersectionObserver reveals fire, then dwell for the 3D engine cooldown
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.7);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo({ top: y });
      await new Promise((r) => setTimeout(r, 140));
    }
    window.scrollTo({ top: document.body.scrollHeight });
  });
  await new Promise((r) => setTimeout(r, 7000)); // 3D warmup+cooldown settle
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await new Promise((r) => setTimeout(r, 700));
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: [
      "--no-sandbox",
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
      "--enable-unsafe-swiftshader", // software WebGL for the 3D brain in headless
    ],
  });
  try {
    for (const theme of THEMES) {
      for (const vp of VIEWPORTS) {
        const page = await browser.newPage();
        await page.evaluateOnNewDocument((t) => {
          try {
            // dark is the attributeless DEFAULT (2026-07-29 reversal); light is the stored choice
            if (t === "light") localStorage.setItem("hq-theme", "light");
            else localStorage.removeItem("hq-theme");
          } catch {}
        }, theme);
        await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
        await page.goto(URL, { waitUntil: "networkidle0", timeout: 90000 });
        await page.waitForSelector(".tile", { timeout: 30000 });
        await settleScroll(page);
        let foldPath = path.join(OUT, `${PREFIX}-${theme}-${vp.name}-fold1.png`);
        await page.screenshot({ path: foldPath });
        foldPath = slim(foldPath);
        let fullPath = path.join(OUT, `${PREFIX}-${theme}-${vp.name}-full.png`);
        await page.screenshot({ path: fullPath, fullPage: true });
        fullPath = slim(fullPath);
        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          theme: document.documentElement.dataset.theme ?? "dark",
          bodyBg: getComputedStyle(document.body).backgroundColor,
          firstTileTop: document.querySelector("section .tile")?.getBoundingClientRect().top ?? null,
          webgl: !!document.querySelector(".brain-wrap canvas"),
        }));
        console.log(`[${theme} ${vp.name}] ${JSON.stringify(metrics)} -> ${path.basename(fullPath)}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log("render-shots: done ->", OUT);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
