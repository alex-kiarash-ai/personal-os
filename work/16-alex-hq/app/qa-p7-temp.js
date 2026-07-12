// P7 QA: render the local HQ prod server, screenshot the required states at 1440 + 390.
// puppeteer-core (app devDependency) with real viewport emulation => 390px is a true mobile
// layout, not a cropped 500px window (the DEPLOY.md QA gotcha).
const puppeteer = require("puppeteer-core");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = "C:/Users/Thinkpad/Desktop/personal-os/outputs/alex-hq/2026-07-12";
const BASE = process.env.QA_BASE || "http://localhost:3111";
const TAG = process.env.QA_TAG || "present-red"; // present-red | empty

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// step-scroll so whileInView (IntersectionObserver) reveals fire — an instant jump never triggers them
async function revealAll(page) {
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h; y += 500) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await sleep(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
}

async function newPage(browser, width, mobile) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: mobile ? 844 : 900, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 60000 });
  await sleep(1300); // client JSON fetches + count-up settle
  return page;
}

async function shootFull(browser, width, mobile, name) {
  const page = await newPage(browser, width, mobile);
  await revealAll(page);
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: true });
  console.log("wrote", file);
  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    await shootFull(browser, 1440, false, `p7-${TAG}-1440-full.png`);
    await shootFull(browser, 390, true, `p7-${TAG}-390-full.png`);

    if (TAG === "present-red") {
      // strip drill-down: click the Waiting-on-you strip, capture the morphed overlay
      const page = await newPage(browser, 1440, false);
      const clicked = await page.evaluate(() => {
        const el = document.querySelector('[aria-label^="Waiting on you"]');
        if (!el) return false;
        el.click();
        return true;
      });
      await sleep(900);
      if (clicked) {
        await page.screenshot({ path: path.join(OUT, "p7-present-red-1440-drilldown.png") });
        console.log("wrote drill-down");
      } else {
        console.log("WARN: strip button not found for drill-down");
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("QA FAILED:", e.message);
  process.exit(1);
});
