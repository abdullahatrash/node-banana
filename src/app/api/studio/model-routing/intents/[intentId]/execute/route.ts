import { and, eq, inArray, isNull } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { resolveDurableProviderKey } from "@/lib/byok/repository";
import { getDb } from "@/lib/db";
import { assets, brandProfiles } from "@/lib/db/schema";
import { productionGenerationExecution } from "@/lib/model-routing/execution-production";
import { PostgresModelRoutingRepository } from "@/lib/model-routing/postgres-repository";
import { inspirationRightsSnapshots, modelGenerationBudgetReservations } from "@/lib/model-routing/db-schema";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { canUseS3Storage, createPresignedDownload } from "@/lib/storage";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const bodySchema = z.object({ prompt: z.string().trim().min(1).max(50_000), sourceAssetIds: z.array(z.string().min(1).max(200)).max(8).default([]) }).strict();

export const POST = withStudioAuth<{ params: Promise<Record<string, string>> }>({ route: "/api/studio/model-routing/intents/[intentId]/execute", action: "write" }, async (request: NextRequest, authz, context) => {
  const intentId = (await context.params).intentId?.trim();
  const key = request.headers.get("idempotency-key");
  let raw: unknown = null; try { raw = await request.json(); } catch { /* invalid below */ }
  const parsed = bodySchema.safeParse(raw);
  if (!intentId || !key || key.length < 8 || request.headers.get("x-workspace-id") !== authz.workspaceId || !parsed.success) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  if (!canUseS3Storage()) return noStoreJson({ success: false, code: "CANONICAL_ARTIFACT_STORAGE_UNAVAILABLE" }, { status: 503 });
  const routing = new PostgresModelRoutingRepository(getDb);
  const intent = await routing.getIntent(authz.workspaceId, intentId);
  if (!intent) return noStoreJson({ success: false, code: "GENERATION_INTENT_NOT_FOUND" }, { status: 404 });
  const [brand] = await getDb().select({ acceptedAt: brandProfiles.acceptedAt, profile: brandProfiles.profile }).from(brandProfiles).where(and(eq(brandProfiles.workspaceId, authz.workspaceId), eq(brandProfiles.id, intent.brand.profileId), eq(brandProfiles.revision, intent.brand.revision), eq(brandProfiles.status, "active"))).limit(1);
  if (!brand?.acceptedAt || canonicalDigest(brand.profile) !== intent.brand.digest) return noStoreJson({ success: false, code: "BRAND_REVISION_NOT_ACCEPTED" }, { status: 409 });
  const [budget] = await getDb().select({ status: modelGenerationBudgetReservations.status, amount: modelGenerationBudgetReservations.quotedAmountUsd }).from(modelGenerationBudgetReservations).where(and(eq(modelGenerationBudgetReservations.workspaceId, authz.workspaceId), eq(modelGenerationBudgetReservations.intentId, intent.id))).limit(1);
  if (!budget || budget.status !== "held" || Number(budget.amount) !== intent.quote.amount * intent.quote.quantity) return noStoreJson({ success: false, code: "AUTHORITATIVE_BUDGET_RESERVATION_UNAVAILABLE" }, { status: 409 });
  const [rights] = await getDb().select({ digest: inspirationRightsSnapshots.digest, permittedRemix: inspirationRightsSnapshots.permittedRemix }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, authz.workspaceId), eq(inspirationRightsSnapshots.id, intent.rights.snapshotId), eq(inspirationRightsSnapshots.revision, intent.rights.revision))).limit(1);
  if (!rights || rights.digest !== intent.rights.digest || rights.permittedRemix !== intent.rights.permittedRemix) return noStoreJson({ success: false, code: "RIGHTS_SNAPSHOT_MISMATCH" }, { status: 409 });
  const sourceIds = [...new Set(parsed.data.sourceAssetIds)];
  if (sourceIds.some((id) => !intent.rights.evidenceRefs.includes(id) && !intent.rights.evidenceRefs.includes(`asset:${id}`))) return noStoreJson({ success: false, code: "RIGHTS_EVIDENCE_MISMATCH" }, { status: 409 });
  const sourceRows = sourceIds.length ? await getDb().select({ id: assets.id, storageKey: assets.storageKey }).from(assets).where(and(eq(assets.workspaceId, authz.workspaceId), inArray(assets.id, sourceIds), isNull(assets.deletedAt))) : [];
  if (sourceRows.length !== sourceIds.length || sourceRows.some((asset) => !asset.storageKey)) return noStoreJson({ success: false, code: "SOURCE_ASSET_UNAVAILABLE" }, { status: 409 });
  const sourceUrls = await Promise.all(sourceRows.map(async (asset) => (await createPresignedDownload({ key: asset.storageKey! })).downloadUrl));
  const credential = await resolveDurableProviderKey(authz.workspaceId, "replicate");
  if (!credential) return noStoreJson({ success: false, code: "DURABLE_REPLICATE_CREDENTIAL_REQUIRED", error: "Async generation requires a Workspace-stored Replicate key; transient request headers are not accepted." }, { status: 409 });
  const result = await productionGenerationExecution(credential).execute({ workspaceId: authz.workspaceId, userId: authz.userId, intentId, rawPrompt: parsed.data.prompt, sourceUrls, idempotencyKey: key });
  const status = result.kind === "accepted" ? 202 : result.kind === "not_found" ? 404 : result.kind === "invalid" || result.kind === "expired" ? 409 : 503;
  return noStoreJson({ success: result.kind === "accepted", result }, { status });
});
