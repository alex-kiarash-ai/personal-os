import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Alex HQ",
    short_name: "Alex HQ",
    description: "The glanceable numbers layer of the Personal OS.",
    start_url: "/",
    display: "standalone",
    background_color: "#04050f",
    theme_color: "#04050f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
