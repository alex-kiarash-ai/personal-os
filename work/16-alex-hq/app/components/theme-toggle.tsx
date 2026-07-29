"use client";

/* The manual day toggle (2026-07-29 reskin, defaults reversed same day on Shaheen's call:
   "Go back to the same colors" — DARK is the default on every open; this is the one control
   that flips to the measured light theme and back). The choice persists in localStorage
   ("hq-theme") and the pre-paint script in layout.tsx replays it before first paint, so there
   is no flash in either direction. Icon-only but 44px and aria-labelled. */

import { useEffect, useState } from "react";

const KEY = "hq-theme";

function applyTheme(light: boolean) {
  const root = document.documentElement;
  if (light) root.dataset.theme = "light";
  else delete root.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#ffffff" : "#001219");
}

export function ThemeToggle() {
  // null until mounted: the server does not know the stored theme, so the first client render
  // must match SSR (the dark default's glyph); the real state lands in the effect. Icon-only.
  const [light, setLight] = useState<boolean | null>(null);
  useEffect(() => {
    setLight(document.documentElement.dataset.theme === "light");
  }, []);

  const isLight = light === true;
  const flip = () => {
    const next = !isLight;
    setLight(next);
    applyTheme(next);
    try {
      localStorage.setItem(KEY, next ? "light" : "dark");
    } catch {
      // storage blocked: the flip still applies for this visit
    }
  };

  return (
    <button
      type="button"
      className="theme-btn"
      onClick={flip}
      aria-label={isLight ? "Switch to night theme" : "Switch to day theme"}
      title={isLight ? "Night theme" : "Day theme"}
    >
      {isLight ? (
        // moon: tap to go dark
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M20.4 14.2A8.6 8.6 0 0 1 9.8 3.6a8.6 8.6 0 1 0 10.6 10.6Z"
            fill="currentColor"
          />
        </svg>
      ) : (
        // sun: tap to go light
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="4.4" fill="currentColor" />
          <path
            d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M4.9 4.9l1.9 1.9M17.2 17.2l1.9 1.9M19.1 4.9l-1.9 1.9M6.8 17.2l-1.9 1.9"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
