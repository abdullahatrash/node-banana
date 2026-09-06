import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { executeAdmittedGeneration } from "@/lib/model-routing/execute-admitted-generation";

const bodySchema = z.object({ prompt: z.string().trim().min(1).max(50_000), sourceAssetIds: z.array(z.string().min(1).max(200)).max(8).default([]) }).strict();

export const POST = withStudioAuth<{ params: Promise<Record<string, string>> }>({ route: "/api/studio/model-routing/intents/[intentId]/execute", action: "write", permission: "product:content:write" }, async (request: NextRequest, authz, context) => {
  const intentId = (await context.params).intentId?.trim();
  const key = request.headers.get("idempotency-key");
  let raw: unknown = null; try { raw = await request.json(); } catch { /* invalid below */ }
  const parsed = bodySchema.safeParse(raw);
  if (!intentId || !key || key.length < 8 || request.headers.get("x-workspace-id") !== authz.workspaceId || !parsed.success) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  const executed = await executeAdmittedGeneration({ workspaceId: authz.workspaceId, userId: authz.userId, role: authz.role, planTier: authz.contentSession.planTier, intentId, prompt: parsed.data.prompt, sourceAssetIds: parsed.data.sourceAssetIds, idempotencyKey: key });
  return executed.ok
    ? noStoreJson({ success: true, result: executed.result }, { status: executed.status })
    : noStoreJson({ success: false, code: executed.code, ...(executed.error ? { error: executed.error } : {}) }, { status: executed.status });
});
