import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { createImmutableRightsEvidence } from "@/lib/model-routing/rights-evidence-repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const body = z.object({
  sourceAssetId: z.string().min(1).max(200), basis: z.enum(["owned","licensed","public_domain","consented"]), permittedRemix: z.enum(["reference_only","transform","derivative"]),
  issuer: z.object({ type: z.enum(["workspace_asset_owner","license_authority","rights_holder","public_registry"]), id: z.string().trim().min(1).max(500) }).strict(),
  scope: z.object({ commercialUse: z.literal(true), derivativeUse: z.boolean(), modelInputUse: z.literal(true), territories: z.array(z.string().trim().min(2).max(100)).min(1).max(100) }).strict(),
  evidenceDocumentAssetId: z.string().min(1).max(200).nullable(), sourceUrl: z.string().url().refine((value) => value.startsWith("https://")).nullable(),
  issuedAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }).nullable(),
}).strict();

export const POST = withStudioAuth<undefined>({ route: "/api/studio/model-routing/rights-evidence", action: "write", permission: "product:content:write" }, async (request: NextRequest, authz) => {
  const key = request.headers.get("idempotency-key")?.trim(); let raw: unknown = null; try { raw = await request.json(); } catch { /* schema handles it */ }
  const parsed = body.safeParse(raw);
  if (!key || key.length < 8 || request.headers.get("x-workspace-id") !== authz.workspaceId || !parsed.success) return noStoreJson({ success: false, code: "INVALID_RIGHTS_EVIDENCE" }, { status: 400 });
  const at = new Date(); const issuedAt = new Date(parsed.data.issuedAt); const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  if (issuedAt > at || (expiresAt && expiresAt <= at)) return noStoreJson({ success: false, code: "RIGHTS_EVIDENCE_DATES_INVALID" }, { status: 422 });
  const result = await createImmutableRightsEvidence({ workspaceId: authz.workspaceId, userId: authz.userId, idempotencyKey: key, ...parsed.data, issuedAt, expiresAt, at });
  return noStoreJson({ success: result.kind === "created" || result.kind === "replayed", result }, { status: result.kind === "invalid" ? 422 : result.kind === "conflict" ? 409 : 200 });
});
