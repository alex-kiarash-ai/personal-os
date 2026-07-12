import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Alex HQ",
    short_name: "Alex HQ",
    description: "The glanceable numbers layer of the Personal OS.",
    start_url: "/",
    display: "standalone",
    // Ink Black (brand/config/color-system.md #1) - was an off-palette near-black (fixed 2026-07-12, d1)
    background_color: "#001219",
    theme_color: "#001219",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
