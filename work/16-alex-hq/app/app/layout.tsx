import type { Metadata, Viewport } from "next";
import { Oxanium, Instrument_Sans, Martian_Mono } from "next/font/google";
import { MotionProvider } from "@/components/motion-provider";
import "./globals.css";

/* Type system re-picked 2026-07-29 (Shaheen: "the font should read more tech") — D6 in
   brand/config/brand-config.md amended same session. All three are variable fonts (one file
   each): Oxanium = display words + kickers (HUD voice), Instrument Sans = body,
   Martian Mono = every data numeral (terminal voice, inherently tabular). */
const display = Oxanium({
  variable: "--font-display",
  subsets: ["latin"],
});

const body = Instrument_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const mono = Martian_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Alex HQ",
  description: "The glanceable numbers layer of the Personal Ops System.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Alex HQ",
  },
};

export const viewport: Viewport = {
  themeColor: "#001219", // dark default (Shaheen 2026-07-29: "go back to the same colors"); the toggle rewrites this meta client-side
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/* Pre-paint theme pick: DARK is the default on every open (Shaheen 2026-07-29, after seeing the
   light renders: "Go back to the same colors"); only a stored explicit "light" flips the
   attribute, before first paint, so neither theme ever flashes. Runs as a parser-blocking
   classic script — body content paints after it. Fail-open: any storage error leaves the
   default dark. */
const THEME_SCRIPT = `try{if(localStorage.getItem("hq-theme")==="light"){document.documentElement.dataset.theme="light";document.querySelector('meta[name="theme-color"]')&&document.querySelector('meta[name="theme-color"]').setAttribute("content","#ffffff");}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: data-theme is set pre-paint by the inline script for dark users,
    // so the server-rendered attribute set (none = light) may legitimately differ.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
