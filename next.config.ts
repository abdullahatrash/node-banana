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
      "**/googleapis/**",
      "**/three/**",
      "**/three-stdlib/**",
      "**/konva/**",
      "**/three-mesh-bvh/**",
      "**/hls.js/**",
      "**/@mediapipe/**",
      "**/@dimforge/**",
      "**/@react-three/**",
      "**/@swc/core*/**",
      "**/lucide-react/**",
      "**/recharts/**",
      "**/public/sample-images/**",
      "**/examples/**",
    ],
  },
};

export default withWorkflow(withMicrofrontends(nextConfig));
