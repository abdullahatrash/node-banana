import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { withMicrofrontends } from "@vercel/microfrontends/next/config";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

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
      "node_modules/hls.js/**",
      "node_modules/@mediapipe/**",
      "node_modules/@dimforge/**",
      "node_modules/lucide-react/**",
      "node_modules/recharts/**",
    ],
  },
  outputFileTracingIncludes: {
    "/api/studio/creatives/*": ["./assets/fonts/creative/**"],
  },
};

export default withWorkflow(withMicrofrontends(withNextIntl(nextConfig)));
