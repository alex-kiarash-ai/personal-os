#!/usr/bin/env node
/**
 * True-viewport renderer + overflow detector for the portfolio site.
 *
 * WHY THIS EXISTS. `chrome --headless --window-size=390,x --screenshot` LIES on
 * Windows: Chrome clamps the window to a ~504px minimum, lays the page out at
 * 504, and then crops the screenshot to 390. The result looks exactly like a
 * page overflowing its viewport, so every narrow render appears broken whether
 * it is or not. Verified 2026-08-05 with a probe page reporting innerWidth=504
 * for a requested 390. That artifact cost a wrong diagnosis and a wrong commit
 * message, so the fix is a tool rather than a note.
 *
 * This drives Chrome over the DevTools Protocol and uses
 * Emulation.setDeviceMetricsOverride, which sets the LAYOUT viewport and is not
 * subject to any window minimum.
 *
 * It also does the thing eyeballing cannot do reliably: reports
 * documentElement.scrollWidth against innerWidth, so horizontal overflow is a
 * number rather than a judgement call about a screenshot.
 *
 * Usage:
 *   node render.js <url> [--out DIR] [--widths 390,768,1440]
 *
 * Requires: Node 21+ (global WebSocket) and Chrome. No npm install.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
];

const args = process.argv.slice(2);
const url = args[0];
if (!url) {
  console.error('usage: node render.js <url> [--out DIR] [--widths 390,768,1440]');
  process.exit(2);
}
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i > -1 && args[i + 1] ? args[i + 1] : dflt;
};
const OUT = flag('out', '.');
const WIDTHS = flag('widths', '390,768,1440').split(',').map((n) => parseInt(n, 10));
const NOSHOT = args.includes('--measure-only');
const FULLPAGE = args.includes('--fullpage');
const DSF = parseFloat(flag('scale', NOSHOT ? '1' : '2'));

const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) { console.error('Chrome not found'); process.exit(2); }

const PORT = 9222 + Math.floor(Math.random() * 700);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let PROC = null;
const reap = () => { try { PROC && PROC.kill(); } catch {} };
process.on('exit', reap);
process.on('SIGINT', () => { reap(); process.exit(130); });
process.on('uncaughtException', (e) => { console.error(e.message); reap(); process.exit(1); });
// Hard ceiling. A hung page must not leave a browser fleet behind, which is
// exactly what happened on the 24-frame portfolio before this existed.
setTimeout(() => { console.error('render: timed out'); reap(); process.exit(1); }, 180000).unref();

(async () => {
  const proc = PROC = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(250);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await r.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch { /* chrome not up yet */ }
  }
  if (!wsUrl) { proc.kill(); console.error('could not reach Chrome DevTools'); process.exit(1); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) =>
    new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

  await send('Page.enable');
  await send('Runtime.enable');

  const results = [];
  for (const width of WIDTHS) {
    const mobile = width < 700;
    await send('Emulation.setDeviceMetricsOverride', {
      width, height: mobile ? 844 : 900, deviceScaleFactor: DSF, mobile,
    });
    await send('Page.navigate', { url });
    await sleep(2200); // fonts + layout settle

    const probe = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const d = document.documentElement;
        // Name the widest offender, so a failure points at an element instead
        // of leaving someone to hunt for it.
        let worst = null, worstW = 0;
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.right > worstW) { worstW = r.right; worst = el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').filter(Boolean).slice(0,2).join('.') : ''); }
        }
        return { innerWidth: innerWidth, scrollWidth: d.scrollWidth, worst, worstRight: Math.round(worstW) };
      })()`,
    });
    const v = probe.result.result.value;
    const overflow = v.scrollWidth > v.innerWidth + 1;
    results.push({ width, ...v, overflow });

    if (!NOSHOT) {
      // captureBeyondViewport on an image-heavy page at 2x is enormous and slow
      // enough to hang the run: a 24-frame portfolio timed out at seven minutes
      // and leaked 17 Chrome processes. Full-page capture is now opt-in.
      const shot = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: FULLPAGE,
      });
      const name = `${new URL(url).pathname.replace(/\W+/g, '_') || 'root'}-${width}.png`;
      fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.result.data, 'base64'));
      results[results.length - 1].file = name;
    }
  }

  ws.close();
  proc.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}

  console.log(`\n${url}`);
  let bad = false;
  for (const r of results) {
    const verdict = r.overflow ? 'OVERFLOW' : 'ok      ';
    if (r.overflow) bad = true;
    console.log(`  ${String(r.width).padStart(5)}px  ${verdict}  innerWidth=${r.innerWidth} scrollWidth=${r.scrollWidth}  widest=${r.worst} (right edge ${r.worstRight})  -> ${r.file}`);
  }
  process.exit(bad ? 1 : 0);
})();
