import { NextRequest, NextResponse } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { recordSafeOperationalTrace } from "@/lib/agent-runtime/safe-diagnostics";
import { isDatabaseConfigured } from "@/lib/db";
import {
  authorizeStudioRequest,
  authzErrorResponse,
  type StudioAuthorizationResult,
} from "@/lib/studio/authz";

type AuthorizedStudio = Extract<StudioAuthorizationResult, { authorized: true }>;

interface WithStudioAuthOptions {
  route: string;
  action: "read" | "write" | "delete";
  permission?: import("@/lib/studio/authz").ContentOSPermission;
}

type RouteContext = { params: Promise<Record<string, string>> };

type StudioRouteHandler = {
  (request: NextRequest): Promise<NextResponse>;
  (request: NextRequest, context: undefined): Promise<NextResponse>;
  (request: NextRequest, context: RouteContext): Promise<NextResponse>;
};

export function withStudioAuth<C extends RouteContext | undefined = undefined>(
  options: WithStudioAuthOptions,
  handler: (
    request: NextRequest,
    authz: AuthorizedStudio,
    context: C,
  ) => Promise<NextResponse>,
) {
  // Next always supplies a route context, including for non-dynamic routes.
  // The two overloads preserve that generated RouteHandlerConfig contract
  // while still allowing unit tests to call context-free handlers directly.
  const wrapped = async (
    request: NextRequest,
    context?: RouteContext,
  ): Promise<NextResponse> => {
    if (!isDatabaseConfigured()) {
      return noStoreJson(
        { success: false, error: "DATABASE_URL is not configured." },
        { status: 503 },
      );
    }

    let authorizedWorkspaceId: string | null = null;
    try {
      const authz = await authorizeStudioRequest(request, options);
      if (!authz.authorized) {
        return authzErrorResponse(authz);
      }
      authorizedWorkspaceId = authz.workspaceId;
      return await handler(request, authz, context as C);
    } catch {
      const operatorTraceRef = await recordSafeOperationalTrace({
        workspaceId: authorizedWorkspaceId,
        category: "runtime",
        severity: "error",
        code: "STUDIO_ROUTE_UNAVAILABLE",
        stage: "execution",
        outcome: "failed",
        providerFamily: "internal",
        httpStatus: null,
        retryable: true,
        durationMs: null,
        attempt: null,
        createdAt: new Date(),
      });
      return noStoreJson(
        {
          success: false,
          error: "Internal server error.",
          code: "STUDIO_ROUTE_UNAVAILABLE",
          operatorTraceRef,
        },
        { status: 500 },
      );
    }
  };
  return wrapped as StudioRouteHandler;
}
