import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { withMicrofrontends } from "@vercel/microfrontends/next/config";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  turbopack: {
    root: __dirname,
  },
  // Prevent heavy client-only packages from being traced into serverless functions
  serverExternalPackages: [
    "googleapis",
    "three",
    "three-stdlib",
    "konva",
    "@react-three/fiber",
    "@react-three/drei",
    "hls.js",
    "@mediapipe/tasks-vision",
    "@dimforge/rapier3d-compat",
  ],
  outputFileTracingExcludes: {
    "*": [
      ".git/**",
      ".swc/**",
      ".pnpm-store/**",
      "drizzle/**",
      "public/**",
      "examples/**",
      "docs/**",
      "scripts/**",
      ".next/cache/**",
      // Client-only packages — never needed server-side
      "node_modules/three/**",
      "node_modules/three-stdlib/**",
      "node_modules/konva/**",
      "node_modules/three-mesh-bvh/**",
      "node_modules/hls.js/**",
      "node_modules/@mediapipe/**",
      "node_modules/@dimforge/**",
      "node_modules/@react-three/**",
      "node_modules/lucide-react/**",
      "node_modules/recharts/**",
    ],
  },
};

export default withWorkflow(withMicrofrontends(nextConfig));
