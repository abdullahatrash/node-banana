import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import { OPERATION_STATES, type OperationKind, type OperationState } from "@/lib/agent-runtime/operation-status/types";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { openOperationCursor, operationFilterDigest, sealOperationCursor } from "@/lib/agent-runtime/operation-status/cursor";

const kinds = ["workflow_run","brand_ingestion","governance_export","governance_bulk","workspace_import","automation","publishing_delivery","generation","persona_training","metric_refresh","ingestion"] as const;
const querySchema = z.object({ state: z.string().optional(), kind: z.string().optional(), cursor: z.string().max(2048).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

function selected<T extends string>(value: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const result = value.split(",").filter((item): item is T => allowed.includes(item as T));
  return result.length ? result : undefined;
}

export const GET = withStudioAuth<undefined>({ route: "/api/studio/operations", action: "read" }, async (request: NextRequest, authz) => {
  if (request.headers.get("x-workspace-id") !== authz.workspaceId) return noStoreJson({ success: false, code: "WORKSPACE_REQUIRED" }, { status: 400 });
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  const states = selected(parsed.data.state, OPERATION_STATES) as OperationState[] | undefined; const selectedKinds = selected(parsed.data.kind, kinds) as OperationKind[] | undefined;
  const filterDigest = operationFilterDigest(states, selectedKinds); const secret = process.env.OPERATION_CURSOR_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) return noStoreJson({ success: false, code: "OPERATION_CURSOR_UNAVAILABLE", error: "Operation pagination is not configured." }, { status: 503 });
  let before: { updatedAt: Date; id: string } | undefined;
  try { before = parsed.data.cursor ? openOperationCursor({ cursor: parsed.data.cursor, workspaceId: authz.workspaceId, filterDigest, secret }) : undefined; } catch { return noStoreJson({ success: false, code: "INVALID_CURSOR" }, { status: 400 }); }
  const values = await PRODUCTION_OPERATION_STATUS.list(authz.workspaceId, { states, kinds: selectedKinds, limit: parsed.data.limit + 1, before }); const items = values.slice(0, parsed.data.limit); const last = items.at(-1);
  const nextCursor = values.length > parsed.data.limit && last ? sealOperationCursor({ workspaceId: authz.workspaceId, filterDigest, updatedAt: last.updatedAt, id: last.id, secret }) : null;
  return noStoreJson({ success: true, items, nextCursor });
});
