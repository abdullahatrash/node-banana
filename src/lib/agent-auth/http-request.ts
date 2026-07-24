import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;

export function noStoreJson(
  body: unknown,
  init?: { status?: number },
): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: NO_STORE_HEADERS,
  });
}

export function requireExplicitAgentWorkspace(
  request: NextRequest,
  authorizedWorkspaceId: string,
): NextResponse | null {
  const selectedWorkspaceId = request.headers.get("x-workspace-id")?.trim();
  if (!selectedWorkspaceId || selectedWorkspaceId !== authorizedWorkspaceId) {
    return NextResponse.json(
      {
        success: false,
        error: "Select a Workspace explicitly for this Agent request.",
      },
      { status: 400 },
    );
  }
  return null;
}

export function requireAgentMutationRequest(
  request: NextRequest,
  authorizedWorkspaceId: string,
): NextResponse | null {
  const workspaceError = requireExplicitAgentWorkspace(
    request,
    authorizedWorkspaceId,
  );
  if (workspaceError) return workspaceError;

  const origin = request.headers.get("origin");
  if (!origin) {
    return NextResponse.json(
      { success: false, error: "A same-origin request is required." },
      { status: 403 },
    );
  }
  try {
    if (new URL(origin).origin !== request.nextUrl.origin) {
      return NextResponse.json(
        { success: false, error: "Cross-origin Agent mutations are forbidden." },
        { status: 403 },
      );
    }
  } catch {
    return NextResponse.json(
      { success: false, error: "A valid same-origin request is required." },
      { status: 403 },
    );
  }
  return null;
}

export async function parseAgentJson<Schema extends z.ZodType>(
  request: NextRequest,
  schema: Schema,
): Promise<
  | { success: true; data: z.infer<Schema> }
  | { success: false; response: NextResponse }
> {
  try {
    const result = schema.safeParse(await request.json());
    if (!result.success) {
      return {
        success: false,
        response: NextResponse.json(
          { success: false, error: "Invalid Agent request body." },
          { status: 400 },
        ),
      };
    }
    return { success: true, data: result.data };
  } catch {
    return {
      success: false,
      response: NextResponse.json(
        { success: false, error: "Request body must be valid JSON." },
        { status: 400 },
      ),
    };
  }
}
