#!/usr/bin/env python
"""
scrape_airbnb.py  -  READ-ONLY harvest of Shaheen's own Airbnb host data.

What it does:
  - Drives a real Chromium with a PERSISTENT profile, so you log in + 2FA ONCE
    and the session is reused on every later run (no repeated login).
  - Pulls reservations + the official earnings CSV from YOUR host dashboard.
  - Writes raw artifacts into work/13-airbnb-host/raw/ for ingest_airbnb.py.
  - NEVER sends a message, accepts/declines, or changes anything. Read only.

Honesty: selectors on airbnb.com change and cannot be tested from inside the
agent session. First real run is a "tune" run: it saves screenshots + page HTML
to raw/_debug/ so the selectors can be fixed against what your account shows.

Usage:
  python scrape_airbnb.py --setup      # first time: opens browser, you log in
  python scrape_airbnb.py              # normal run (headed, reuses session)
  python scrape_airbnb.py --headless   # try without a visible window
"""
import sys, os, re, json, time, random, datetime as dt
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
except ImportError:
    sys.exit("Playwright not installed. Run:  python -m pip install playwright && python -m playwright install chromium")

HERE = Path(__file__).resolve().parent
PROFILE_DIR = HERE / ".browser-profile"        # sensitive: holds your logged-in session. Treat like a password.
RAW = HERE / "raw"
DEBUG = RAW / "_debug"
for d in (PROFILE_DIR, RAW, DEBUG):
    d.mkdir(parents=True, exist_ok=True)

TODAY = dt.date.today().isoformat()

# --- Targets. URLs are stable-ish; selectors are best-guess and may need tuning. ---
URL_HOST_HOME   = "https://www.airbnb.com/hosting"
URL_RESERVATIONS = "https://www.airbnb.com/hosting/reservations/all"
URL_EARNINGS     = "https://www.airbnb.com/hosting/earnings"

# Buttons we try, in order, by accessible name (case-insensitive regex).
EXPORT_BUTTON_NAMES = [r"get report", r"export", r"download csv", r"create report"]

HEADLESS = "--headless" in sys.argv
SETUP    = "--setup" in sys.argv


def jitter(a=0.6, b=1.8):
    time.sleep(random.uniform(a, b))


def is_logged_in(page) -> bool:
    """Heuristic: on the host home, a logged-out user gets bounced to /login."""
    try:
        page.goto(URL_HOST_HOME, wait_until="domcontentloaded", timeout=45000)
    except PWTimeout:
        return False
    jitter()
    url = page.url.lower()
    if "login" in url or "/signup" in url:
        return False
    # logged-in host pages expose a hosting nav; fall back to "not on login" = ok
    return True


def poll_login(ctx, timeout=420):
    """Wait until logged in, checking in a SEPARATE tab so the login tab is undisturbed."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(10)
        tmp = ctx.new_page()
        try:
            tmp.goto(URL_HOST_HOME, wait_until="domcontentloaded", timeout=30000)
            u = tmp.url.lower()
            if "login" not in u and "signup" not in u:
                return True
        except Exception:
            pass
        finally:
            if not tmp.is_closed():
                tmp.close()
        print("   ...still waiting for login")
    return False


def save_debug(page, tag):
    try:
        page.screenshot(path=str(DEBUG / f"{tag}-{TODAY}.png"), full_page=True)
        (DEBUG / f"{tag}-{TODAY}.html").write_text(page.content(), encoding="utf-8")
        print(f"   [debug] saved {tag} screenshot + html")
    except Exception as e:
        print(f"   [debug] could not save {tag}: {e}")


def try_export_csv(page) -> bool:
    """Navigate to earnings and try to download the official transaction CSV."""
    print(" - earnings: attempting official CSV export ...")
    try:
        page.goto(URL_EARNINGS, wait_until="domcontentloaded", timeout=45000)
    except PWTimeout:
        print("   earnings page slow to load; saving debug.")
    jitter(1.0, 2.5)
    save_debug(page, "earnings")
    for name in EXPORT_BUTTON_NAMES:
        try:
            btn = page.get_by_role("button", name=re.compile(name, re.I))
            if btn.count() == 0:
                btn = page.get_by_text(re.compile(name, re.I)).first
            if btn and btn.count() > 0:
                with page.expect_download(timeout=30000) as dl:
                    btn.first.click()
                    jitter()
                download = dl.value
                out = RAW / f"airbnb-earnings-{TODAY}.csv"
                download.save_as(str(out))
                print(f"   [ok] CSV downloaded -> {out.name}")
                return True
        except PWTimeout:
            continue
        except Exception as e:
            print(f"   export attempt '{name}' failed: {e}")
            continue
    print("   [warn] no CSV export captured. The export flow may need a date-range step.")
    print("          Check raw/_debug/earnings-*.png to see what the page shows, then we tune selectors.")
    return False


def scrape_reservations(page):
    """Best-effort DOM scrape of the reservations table as a fallback / supplement."""
    print(" - reservations: scraping list ...")
    try:
        page.goto(URL_RESERVATIONS, wait_until="domcontentloaded", timeout=45000)
    except PWTimeout:
        print("   reservations page slow to load.")
    jitter(1.0, 2.5)
    # lazy lists: scroll to force render
    for _ in range(6):
        page.mouse.wheel(0, 2200)
        jitter(0.4, 0.9)
    save_debug(page, "reservations")
    rows = []
    try:
        # Airbnb renders reservations as table rows or cards; grab table rows first.
        trs = page.locator("table tr")
        n = trs.count()
        for i in range(n):
            txt = trs.nth(i).inner_text().strip()
            if txt:
                rows.append(txt.replace("\n", " | "))
    except Exception as e:
        print(f"   table scrape failed: {e}")
    out = RAW / f"reservations-{TODAY}.json"
    out.write_text(json.dumps({"scraped": TODAY, "rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"   [ok] captured {len(rows)} raw rows -> {out.name} (parsed by ingest step)")


def main():
    print(f"== Airbnb read-only harvest ({TODAY}) ==")
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=(HEADLESS and not SETUP),
            accept_downloads=True,
            viewport={"width": 1440, "height": 900},
            locale="en-US",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        if SETUP:
            print("SETUP: a browser window is open. Log into Airbnb now (do the 2FA).")
            try:
                page.goto("https://www.airbnb.com/login", wait_until="domcontentloaded")
            except PWTimeout:
                pass
            print("Waiting (up to 7 min) for login to complete; checking every 10s ...")
            ok = poll_login(ctx, timeout=420)
            print("[ok] session saved. Future runs reuse it, no login needed." if ok
                  else "[warn] login not detected. Re-run with --setup.")
            ctx.close(); return

        if not is_logged_in(page):
            print("[stop] Not logged in. Run once with --setup first:")
            print("       python scrape_airbnb.py --setup")
            ctx.close(); sys.exit(2)

        print("[ok] logged-in session active.")
        try_export_csv(page)
        scrape_reservations(page)
        ctx.close()
    print("\nDone. Next:  python ingest_airbnb.py   (parses raw/ into the Excel model)")


if __name__ == "__main__":
    main()
