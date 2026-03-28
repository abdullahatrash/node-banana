import type { NextRequest } from "next/server";
import { runMicrofrontendsMiddleware } from "@vercel/microfrontends/next/middleware";

export async function middleware(request: NextRequest) {
  // Phase 1: all /editor/* routes go directly to the OpenCut microfrontend
  // Phase 2: add "flag" field to microfrontends.json and use flagValues here
  // to gate access by user plan (requires @vercel/microfrontends flag support)
  const response = await runMicrofrontendsMiddleware({ request, flagValues: {} });

  if (response) return response;
}

export const config = {
  matcher: [
    "/.well-known/vercel/microfrontends/client-config",
    "/editor/:path*",
  ],
};
