import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GenMeet — Video Calls & Meetings",
    short_name: "GenMeet",
    description: "Real-time WebRTC video conferencing, screen sharing, and chat.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1a73e8",
    orientation: "any",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
