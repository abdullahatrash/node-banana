import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/);
const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("retry") }).strict(),
]);

function status(result: { kind: string }) { return result.kind === "not_found" ? 404 : result.kind === "conflict" ? 409 : result.kind === "unavailable" ? 503 : 200; }

export const GET = withStudioAuth<{ params: Promise<Record<string, string>> }>({ route: "/api/studio/operations/[operationId]", action: "read" }, async (request: NextRequest, authz, context) => {
  const operationId = idSchema.safeParse((await context.params).operationId);
  if (!operationId.success || request.headers.get("x-workspace-id") !== authz.workspaceId) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  const [operation, events] = await Promise.all([PRODUCTION_OPERATION_STATUS.get(authz.workspaceId, operationId.data), PRODUCTION_OPERATION_STATUS.listEvents(authz.workspaceId, operationId.data)]);
  return operation ? noStoreJson({ success: true, operation, events }) : noStoreJson({ success: false, code: "NOT_FOUND" }, { status: 404 });
});

export const POST = withStudioAuth<{ params: Promise<Record<string, string>> }>({ route: "/api/studio/operations/[operationId]", action: "write" }, async (request: NextRequest, authz, context) => {
  const operationId = idSchema.safeParse((await context.params).operationId);
  const key = request.headers.get("idempotency-key");
  let body: unknown = null; try { body = await request.json(); } catch { /* invalid below */ }
  const parsed = mutationSchema.safeParse(body);
  if (!operationId.success || !parsed.success || !key || key.length < 8 || request.headers.get("x-workspace-id") !== authz.workspaceId) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  const current = await PRODUCTION_OPERATION_STATUS.get(authz.workspaceId, operationId.data);
  if (!current) return noStoreJson({ success: false, code: "NOT_FOUND" }, { status: 404 });
  const ownsOperation = current.actor.type === "human" && current.actor.userId === authz.userId;
  if (!ownsOperation && authz.role !== "owner" && authz.role !== "admin") return noStoreJson({ success: false, code: "FORBIDDEN" }, { status: 403 });
  const actor = { type: "human" as const, userId: authz.userId };
  const result = parsed.data.action === "cancel"
    ? await PRODUCTION_OPERATION_STATUS.requestCancellation({ workspaceId: authz.workspaceId, operationId: operationId.data, expectedRevision: parsed.data.expectedRevision, actor, idempotencyKey: key })
    : await PRODUCTION_OPERATION_STATUS.retry({ workspaceId: authz.workspaceId, operationId: operationId.data, actor, idempotencyKey: key });
  return noStoreJson({ success: result.kind === "applied" || result.kind === "replayed", result }, { status: status(result) });
});
