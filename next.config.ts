import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { withMicrofrontends } from "@vercel/microfrontends/next/config";

const localOnlyRouteExcludes = [
  "./node_modules/googleapis/**",
  "./node_modules/three/**",
  "./node_modules/three-stdlib/**",
  "./node_modules/konva/**",
  "./node_modules/three-mesh-bvh/**",
  "./node_modules/hls.js/**",
  "./node_modules/@mediapipe/**",
  "./node_modules/@dimforge/**",
  "./node_modules/@react-three/**",
  "./node_modules/@swc/core*/**",
  "./node_modules/lucide-react/**",
  "./node_modules/recharts/**",
  "./node_modules/.pnpm/googleapis@*/**",
  "./node_modules/.pnpm/three@*/**",
  "./node_modules/.pnpm/three-stdlib@*/**",
  "./node_modules/.pnpm/konva@*/**",
  "./node_modules/.pnpm/three-mesh-bvh@*/**",
  "./node_modules/.pnpm/hls.js@*/**",
  "./node_modules/.pnpm/@mediapipe+*/**",
  "./node_modules/.pnpm/@dimforge+*/**",
  "./node_modules/.pnpm/@react-three+*/**",
  "./node_modules/.pnpm/@swc+core*/**",
  "./node_modules/.pnpm/lucide-react@*/**",
  "./node_modules/.pnpm/recharts@*/**",
  "./public/sample-images/**",
  "./examples/**",
];

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
    // Exclude non-runtime files from ALL serverless functions
    "*": [
      "./.git/**",
      "./.swc/**",
      "./drizzle/**",
      "./public/**",
      "./examples/**",
      "./docs/**",
      "./scripts/**",
      "./.next/cache/**",
    ],
    // Additionally exclude heavy deps from local-only routes
    "/api/load-generation": localOnlyRouteExcludes,
    "/api/save-generation": localOnlyRouteExcludes,
  },
};

export default withWorkflow(withMicrofrontends(nextConfig));
