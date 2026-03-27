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
};

export default withWorkflow(withMicrofrontends(nextConfig));
