import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import {
  authorizeStudioRequest,
  authzErrorResponse,
  type StudioAuthorizationResult,
} from "@/lib/studio/authz";
import { logger } from "@/utils/logger";

type AuthorizedStudio = Extract<StudioAuthorizationResult, { authorized: true }>;

interface WithStudioAuthOptions {
  route: string;
  action: "read" | "write" | "delete";
}

type RouteContext = { params: Promise<Record<string, string>> };

export function withStudioAuth<C extends RouteContext | undefined = undefined>(
  options: WithStudioAuthOptions,
  handler: (
    request: NextRequest,
    authz: AuthorizedStudio,
    context: C,
  ) => Promise<NextResponse>,
) {
  // The returned function's `context` parameter is typed as the widest shape
  // Next.js passes: Next provides `{ params: Promise<...> }` even for
  // non-dynamic routes, so typing it from the generic `C` (which defaults to
  // `undefined`) fails Next's build-time RouteHandlerConfig validation. It
  // stays optional so unit tests can invoke non-dynamic handlers with a
  // single argument. The generic `C` narrows the context only for the inner
  // handler (via the contained cast below).
  return async (
    request: NextRequest,
    context?: RouteContext,
  ): Promise<NextResponse> => {
    if (!isDatabaseConfigured()) {
      return NextResponse.json(
        { success: false, error: "DATABASE_URL is not configured." },
        { status: 503 },
      );
    }

    try {
      const authz = await authorizeStudioRequest(request, options);
      if (!authz.authorized) {
        return authzErrorResponse(authz);
      }
      return await handler(request, authz, context as C);
    } catch (error) {
      logger.error(
        "system",
        "Unhandled studio route error",
        { route: options.route },
        error instanceof Error ? error : undefined,
      );
      return NextResponse.json(
        { success: false, error: "Internal server error." },
        { status: 500 },
      );
    }
  };
}
