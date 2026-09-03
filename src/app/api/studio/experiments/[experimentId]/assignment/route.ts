import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { getReleaseControlService } from "@/lib/release-control/production";
import { ReleaseControlConflictError } from "@/lib/release-control/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

type Context = { params: Promise<{ experimentId: string }> };

export const POST = withStudioAuth<Context>({ route: "/api/studio/experiments/[experimentId]/assignment", action: "read" }, async (request: NextRequest, authz, context) => {
  const key = request.headers.get("idempotency-key")?.trim() || "";
  if (key.length < 8 || key.length > 200) return noStoreJson({ success: false, code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
  try {
    const { experimentId } = await context.params;
    const result = await getReleaseControlService().assignExperiment(authz.workspaceId, authz.userId, experimentId, key);
    return noStoreJson({ success: true, assignment: { experimentId: result.assignment.experimentId, assignmentRevision: result.assignment.assignmentRevision, variant: result.assignment.variant, assignedAt: result.assignment.assignedAt, expiresAt: result.assignment.expiresAt }, replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof ReleaseControlConflictError) return noStoreJson({ success: false, code: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
    if (error instanceof SyntaxError || error instanceof TypeError) return noStoreJson({ success: false, code: error.message }, { status: 400 });
    throw error;
  }
});
