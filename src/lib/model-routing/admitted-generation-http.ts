import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { admitStudioGeneration } from "./admitted-generation-service";

const modelRef = z.object({ provider: z.literal("replicate"), model: z.string().min(1).max(200), version: z.string().min(8).max(200), inputSchemaDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict();
const briefList = z.array(z.string().trim().min(1).max(200)).max(50);
const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(50_000), model: modelRef,
  capability: z.enum(["text_generation","text_to_image","image_to_image","text_to_video","image_to_video","video_to_video"]),
  contentLanguage: z.enum(["ar","en","mixed"]), arabicVariety: z.enum(["msa","gulf","egyptian","levantine","maghrebi","other"]).nullable(),
  quantity: z.number().positive().max(600), sourceAssetIds: z.array(z.string().min(1).max(200)).max(20).default([]),
  rightsBasis: z.enum(["owned","licensed","public_domain","consented"]), permittedRemix: z.enum(["reference_only","transform","derivative"]), rightsEvidenceIds: z.array(z.string().min(1).max(200)).max(20).default([]),
  remixBrief: z.object({ preserve: briefList, transform: briefList, avoid: briefList }).strict(),
  fundingMode: z.enum(["byok", "managed"]).default("byok"),
  managedQuoteAcceptance: z.object({ quoteId: z.string().uuid(), confirmationDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).transform((value) => value as `sha256:${string}`) }).strict().nullable().optional(),
  personaId: z.string().min(1).max(200).nullable().default(null),
  contentExecution: z.object({ contentPieceId: z.string().min(1).max(200), contentPieceRevision: z.number().int().positive() }).strict().nullable().default(null),
}).strict();

export function createAdmittedGenerationPost(route: string) {
  return withStudioAuth<undefined>({ route, action: "write", permission: "product:content:write" }, async (request: NextRequest, authz) => {
    const key = request.headers.get("idempotency-key")?.trim(); let raw: unknown = null; try { raw = await request.json(); } catch { /* schema handles it */ }
    const parsed = bodySchema.safeParse(raw);
    if (request.headers.get("x-workspace-id") !== authz.workspaceId || !key || key.length < 8 || !parsed.success) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
    const result = await admitStudioGeneration({ workspaceId: authz.workspaceId, userId: authz.userId, role: authz.role, planTier: authz.contentSession.planTier, idempotencyKey: key, input: parsed.data });
    return result.ok ? noStoreJson({ success: true, ...result.value }, { status: result.status }) : noStoreJson({ success: false, code: result.code, nextActions: result.nextActions ?? [], ...(result.managedCreditQuote ? { managedCreditQuote: result.managedCreditQuote } : {}) }, { status: result.status });
  });
}
