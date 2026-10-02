import type { NextConfig } from "next";

const app = process.env.AVYORA_APP;
const distDir =
  app === "admin" ? ".next-admin" : app === "logistics" ? ".next-logistics" : ".next";

const nextConfig: NextConfig = {
  // Phone browsers use the PC's Wi-Fi address, not localhost. Without this,
  // Next blocks /_next scripts and styles, so the page opens but nothing loads.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*", "172.17.*.*", "172.18.*.*", "172.19.*.*", "172.20.*.*", "172.21.*.*", "172.22.*.*", "172.23.*.*", "172.24.*.*", "172.25.*.*", "172.26.*.*", "172.27.*.*", "172.28.*.*", "172.29.*.*", "172.30.*.*", "172.31.*.*"],
  distDir,
  // Standalone output is required for the production Docker image.
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" as const } : {}),
  serverExternalPackages: ["bwip-js"],
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
};

export default nextConfig;
