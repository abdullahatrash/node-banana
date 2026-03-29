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
  // Prevent heavy packages from being bundled into every serverless function
  serverExternalPackages: ["googleapis", "three", "three-stdlib", "konva"],
  outputFileTracingExcludes: {
    "*": [
      "./node_modules/.pnpm/googleapis@*/**",
      "./node_modules/.pnpm/three@*/**",
      "./node_modules/.pnpm/three-stdlib@*/**",
      "./node_modules/.pnpm/konva@*/**",
    ],
  },
};

export default withWorkflow(withMicrofrontends(nextConfig));
