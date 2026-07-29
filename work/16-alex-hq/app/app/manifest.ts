import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Alex HQ",
    short_name: "Alex HQ",
    description: "The glanceable numbers layer of the Personal Ops System.",
    start_url: "/",
    display: "standalone",
    // Ink Black (law #1): dark is the default canvas again (Shaheen 2026-07-29, "go back to the
    // same colors"); the in-app day toggle rewrites the live meta, the installed-PWA chrome
    // follows this manifest.
    background_color: "#001219",
    theme_color: "#001219",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
