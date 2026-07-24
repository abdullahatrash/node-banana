import type { NextRequest } from "next/server";
import type { CapabilityDispatchContext } from "@/types/capabilities";

type CredentialHumanContext = NonNullable<
  CapabilityDispatchContext["securityContext"]
> & { kind: "human" };

export function credentialHumanContext(
  request: NextRequest,
  authz: {
    workspaceId: string;
    userId: string;
    role: "owner" | "admin" | "member";
  },
): CredentialHumanContext | null {
  const selectedWorkspaceId = request.headers.get("x-workspace-id")?.trim();
  if (
    !selectedWorkspaceId ||
    selectedWorkspaceId !== authz.workspaceId
  ) {
    return null;
  }
  const rawIdempotencyKey = request.headers.get("idempotency-key")?.trim();
  const idempotencyKey =
    rawIdempotencyKey &&
    rawIdempotencyKey.length >= 8 &&
    rawIdempotencyKey.length <= 200 &&
    !/[\u0000-\u001f\u007f]/.test(rawIdempotencyKey)
      ? rawIdempotencyKey
      : undefined;
  return {
    kind: "human",
    workspaceId: selectedWorkspaceId,
    userId: authz.userId,
    role: authz.role,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}
