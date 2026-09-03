import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { findCuratedModel } from "@/lib/model-routing/catalog";
import { PRODUCTION_MODEL_ROUTING } from "@/lib/model-routing/production";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const ref = z.object({ provider: z.enum(["replicate","google","kie","openai","fal","wavespeed"]), model: z.string().min(1).max(200), version: z.string().min(1).max(200), inputSchemaDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) });
const body = z.object({ source: ref, targets: z.array(ref).min(1).max(10), capability: z.enum(["text_to_image","image_to_image","text_to_video","image_to_video","video_to_video"]), minimumQuality: z.enum(["preview","standard","premium"]), contentLanguage: z.enum(["ar","en","mixed"]), arabicVariety: z.enum(["msa","gulf","egyptian","levantine","maghrebi","other"]).nullable(), verifiedRegion: z.string().min(1).max(80), executionMode: z.enum(["sync","async"]), maxTotalCostUsd: z.number().positive().max(100), expiresAt: z.string().datetime() }).strict();
const workspaceMatches = (request: NextRequest, workspaceId: string) => request.headers.get("x-workspace-id") === workspaceId;

export const GET = withStudioAuth<undefined>({ route: "/api/studio/model-routing/authorizations", action: "read" }, async (request, authz) => workspaceMatches(request, authz.workspaceId) ? noStoreJson({ success: true, items: await PRODUCTION_MODEL_ROUTING.listAuthorizations(authz.workspaceId) }) : noStoreJson({ success: false, code: "WORKSPACE_REQUIRED" }, { status: 400 }));

export const POST = withStudioAuth<undefined>({ route: "/api/studio/model-routing/authorizations", action: "write" }, async (request, authz) => {
  if (!workspaceMatches(request, authz.workspaceId)) return noStoreJson({ success: false, code: "WORKSPACE_REQUIRED" }, { status: 400 });
  if (authz.role !== "owner" && authz.role !== "admin") return noStoreJson({ success: false, code: "FORBIDDEN" }, { status: 403 });
  const key = request.headers.get("idempotency-key"); let value: unknown = null; try { value = await request.json(); } catch { /* invalid */ } const parsed = body.safeParse(value);
  if (!key || key.length < 8 || !parsed.success || !findCuratedModel(parsed.data.source) || parsed.data.targets.some((item) => !findCuratedModel(item))) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  const result = await PRODUCTION_MODEL_ROUTING.issueAuthorization({ workspaceId: authz.workspaceId, ...parsed.data, expiresAt: new Date(parsed.data.expiresAt), userId: authz.userId, idempotencyKey: key });
  const status = result.kind === "invalid" ? 400 : result.kind === "conflict" ? 409 : result.kind === "unavailable" ? 503 : 200;
  return noStoreJson({ success: status === 200, result }, { status });
});
