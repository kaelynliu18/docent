import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Docent",
    short_name: "Docent",
    description: "Rank the paintings you saw on museum visits; find where to go next.",
    id: "/",
    start_url: "/visits?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ebe7e0",
    theme_color: "#ebe7e0",
    categories: ["lifestyle", "travel", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Add photos", url: "/add", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Rank", url: "/rank", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
