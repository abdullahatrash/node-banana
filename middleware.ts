import type { NextRequest } from "next/server";
import { runMicrofrontendsMiddleware } from "@vercel/microfrontends/next/middleware";

export async function middleware(request: NextRequest) {
  const response = await runMicrofrontendsMiddleware({
    request,
    flagValues: {
      "editor-enabled": async () => {
        // Phase 1: all authenticated users get editor access
        // Phase 2: check user plan from session/DB
        return true;
      },
    },
  });

  if (response) return response;
}

export const config = {
  matcher: [
    "/.well-known/vercel/microfrontends/client-config",
    "/editor/:path*",
  ],
};
