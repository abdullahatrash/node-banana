import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import { OPERATION_STATES, type OperationKind, type OperationState } from "@/lib/agent-runtime/operation-status/types";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const kinds = ["workflow_run","brand_ingestion","governance_export","governance_bulk","workspace_import","automation","publishing_delivery","generation"] as const;
const querySchema = z.object({ state: z.string().optional(), kind: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

function selected<T extends string>(value: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const result = value.split(",").filter((item): item is T => allowed.includes(item as T));
  return result.length ? result : undefined;
}

export const GET = withStudioAuth<undefined>({ route: "/api/studio/operations", action: "read" }, async (request: NextRequest, authz) => {
  if (request.headers.get("x-workspace-id") !== authz.workspaceId) return noStoreJson({ success: false, code: "WORKSPACE_REQUIRED" }, { status: 400 });
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  const items = await PRODUCTION_OPERATION_STATUS.list(authz.workspaceId, { states: selected(parsed.data.state, OPERATION_STATES) as OperationState[] | undefined, kinds: selected(parsed.data.kind, kinds) as OperationKind[] | undefined, limit: parsed.data.limit });
  return noStoreJson({ success: true, items });
});
