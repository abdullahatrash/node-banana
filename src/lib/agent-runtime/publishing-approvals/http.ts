import type { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { PublishingApprovalServiceError } from "./errors";

export function requirePublishingApprovalWorkspace(
  request: NextRequest,
  authorizedWorkspaceId: string,
) {
  const selected = request.headers.get("x-workspace-id")?.trim();
  if (!selected || selected !== authorizedWorkspaceId) {
    return noStoreJson(
      { success: false, error: "Select this Workspace explicitly." },
      { status: 400 },
    );
  }
  return null;
}

export function requirePublishingApprovalMutation(
  request: NextRequest,
  authorizedWorkspaceId: string,
) {
  const workspaceError = requirePublishingApprovalWorkspace(
    request,
    authorizedWorkspaceId,
  );
  if (workspaceError) return workspaceError;
  const origin = request.headers.get("origin");
  try {
    if (!origin || new URL(origin).origin !== request.nextUrl.origin) {
      return noStoreJson(
        { success: false, error: "A same-origin human mutation is required." },
        { status: 403 },
      );
    }
  } catch {
    return noStoreJson(
      { success: false, error: "A same-origin human mutation is required." },
      { status: 403 },
    );
  }
  return null;
}

export function publishingApprovalErrorResponse(error: unknown) {
  if (!(error instanceof PublishingApprovalServiceError)) {
    return noStoreJson(
      {
        success: false,
        error: "Publishing Approval evidence is temporarily unavailable.",
      },
      { status: 503 },
    );
  }
  const status =
    error.code === "PUBLISHING_APPROVAL_NOT_FOUND"
      ? 404
      : error.code === "PUBLISHING_APPROVAL_AUTHORITY_REQUIRED"
        ? 403
        : error.code === "PUBLISHING_APPROVAL_PERSISTENCE_UNAVAILABLE"
          ? 503
          : error.code === "PUBLISHING_APPROVAL_INVALID_INPUT"
            ? 400
            : 409;
  return noStoreJson(
    { success: false, code: error.code, error: error.message },
    { status },
  );
}
