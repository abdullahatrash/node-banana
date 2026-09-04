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
import { validateRightsEvidence } from "@/lib/model-routing/rights-evidence";
import { getReleaseControlService } from "@/lib/release-control/production";
import { loadImmutableBrandContext } from "@/lib/model-routing/brand-context";
import { findCuratedModel } from "@/lib/model-routing/catalog";
import { validateGenerationSources } from "@/lib/model-routing/source-validation";

const bodySchema = z.object({ prompt: z.string().trim().min(1).max(50_000), sourceAssetIds: z.array(z.string().min(1).max(200)).max(8).default([]) }).strict();

export const POST = withStudioAuth<{ params: Promise<Record<string, string>> }>({ route: "/api/studio/model-routing/intents/[intentId]/execute", action: "write" }, async (request: NextRequest, authz, context) => {
  const intentId = (await context.params).intentId?.trim();
  const key = request.headers.get("idempotency-key");
  let raw: unknown = null; try { raw = await request.json(); } catch { /* invalid below */ }
  const parsed = bodySchema.safeParse(raw);
  if (!intentId || !key || key.length < 8 || request.headers.get("x-workspace-id") !== authz.workspaceId || !parsed.success) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  const routing = new PostgresModelRoutingRepository(getDb);
  const intent = await routing.getIntent(authz.workspaceId, intentId);
  if (!intent) return noStoreJson({ success: false, code: "GENERATION_INTENT_NOT_FOUND" }, { status: 404 });
  if (intent.outputContract.mediaType !== "text" && !canUseS3Storage()) return noStoreJson({ success: false, code: "CANONICAL_ARTIFACT_STORAGE_UNAVAILABLE" }, { status: 503 });
  const releaseFlagId = process.env.ADMITTED_GENERATION_RELEASE_FLAG_ID?.trim();
  if (!releaseFlagId && process.env.NODE_ENV === "production") return noStoreJson({ success: false, code: "GENERATION_RELEASE_FLAG_UNCONFIGURED" }, { status: 503 });
  if (releaseFlagId) {
    try {
      const flag = await getReleaseControlService().evaluateReleaseFlag(authz.workspaceId, authz.userId, releaseFlagId, { role: authz.role, entitlement: authz.contentSession.planTier, locale: intent.contentLanguage === "en" ? "en" : "ar", entryPoint: "admitted_generation_execute" }, `${key}:flag`);
      if (!flag.enabled) return noStoreJson({ success: false, code: "GENERATION_RELEASE_FLAG_DISABLED" }, { status: 409 });
    } catch {
      return noStoreJson({ success: false, code: "GENERATION_RELEASE_FLAG_UNAVAILABLE" }, { status: 503 });
    }
  }
  const [brand] = await getDb().select({ acceptedAt: brandProfiles.acceptedAt, profile: brandProfiles.profile }).from(brandProfiles).where(and(eq(brandProfiles.workspaceId, authz.workspaceId), eq(brandProfiles.id, intent.brand.profileId), eq(brandProfiles.revision, intent.brand.revision), eq(brandProfiles.status, "active"))).limit(1);
  if (!brand?.acceptedAt || canonicalDigest(brand.profile) !== intent.brand.digest) return noStoreJson({ success: false, code: "BRAND_REVISION_NOT_ACCEPTED" }, { status: 409 });
  const [budget] = await getDb().select({ status: modelGenerationBudgetReservations.status, amount: modelGenerationBudgetReservations.quotedAmountUsd }).from(modelGenerationBudgetReservations).where(and(eq(modelGenerationBudgetReservations.workspaceId, authz.workspaceId), eq(modelGenerationBudgetReservations.intentId, intent.id))).limit(1);
  if (!budget || budget.status !== "held" || Number(budget.amount) !== intent.quote.amount * intent.quote.quantity) return noStoreJson({ success: false, code: "AUTHORITATIVE_BUDGET_RESERVATION_UNAVAILABLE" }, { status: 409 });
  const [rights] = await getDb().select({ digest: inspirationRightsSnapshots.digest, permittedRemix: inspirationRightsSnapshots.permittedRemix }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, authz.workspaceId), eq(inspirationRightsSnapshots.id, intent.rights.snapshotId), eq(inspirationRightsSnapshots.revision, intent.rights.revision))).limit(1);
  if (!rights || rights.digest !== intent.rights.digest || rights.permittedRemix !== intent.rights.permittedRemix) return noStoreJson({ success: false, code: "RIGHTS_SNAPSHOT_MISMATCH" }, { status: 409 });
  const sourceIds = [...parsed.data.sourceAssetIds];
  if (sourceIds.length !== intent.rights.sourceAssetIds.length || sourceIds.some((id, index) => id !== intent.rights.sourceAssetIds[index])) return noStoreJson({ success: false, code: "RIGHTS_EVIDENCE_MISMATCH" }, { status: 409 });
  const rightsValidation = validateRightsEvidence({ workspaceId: authz.workspaceId, basis: intent.rights.basis, permittedRemix: intent.rights.permittedRemix, sourceAssetIds: intent.rights.sourceAssetIds, evidence: intent.rights.evidence, at: new Date() });
  if (!rightsValidation.ok) return noStoreJson({ success: false, code: rightsValidation.code }, { status: 409 });
  const fetchedRows = sourceIds.length ? await getDb().select({ id: assets.id, type: assets.type, storageKey: assets.storageKey, checksum: assets.checksum, mimeType: assets.mimeType, width: assets.width, height: assets.height, durationSeconds: assets.durationSeconds, metadata: assets.metadata }).from(assets).where(and(eq(assets.workspaceId, authz.workspaceId), inArray(assets.id, sourceIds), isNull(assets.deletedAt))) : [];
  const sourceById = new Map(fetchedRows.map((row) => [row.id, row]));
  const sourceRows = sourceIds.map((id) => sourceById.get(id)).filter((row): row is (typeof fetchedRows)[number] => Boolean(row));
  if (sourceRows.length !== sourceIds.length || sourceRows.some((asset) => !asset.storageKey)) return noStoreJson({ success: false, code: "SOURCE_ASSET_UNAVAILABLE" }, { status: 409 });
  if (sourceRows.some((asset) => intent.rights.evidence.find((item) => item.sourceAssetId === asset.id)?.sourceDigest !== asset.checksum)) return noStoreJson({ success: false, code: "RIGHTS_SOURCE_DIGEST_MISMATCH" }, { status: 409 });
  const descriptor = findCuratedModel(intent.selectedModel);
  if (!descriptor || descriptor.qualification.status !== "qualified") return noStoreJson({ success: false, code: "MODEL_NOT_EXECUTABLE" }, { status: 409 });
  const sourceValidation = validateGenerationSources(intent.capability, sourceIds, sourceRows.map((row) => ({ ...row, metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : null })), descriptor.qualification.inputContract.imageMode);
  if (!sourceValidation.ok) return noStoreJson({ success: false, code: sourceValidation.code }, { status: 409 });
  const sourceUrls = await Promise.all(sourceRows.map(async (asset) => (await createPresignedDownload({ key: asset.storageKey! })).downloadUrl));
  const brandContext = await loadImmutableBrandContext({ workspaceId: authz.workspaceId, profileId: intent.brand.profileId, revision: intent.brand.revision, acceptedAt: brand.acceptedAt, profile: brand.profile });
  if (!brandContext || brandContext.context.digest !== intent.brand.context.digest) return noStoreJson({ success: false, code: "BRAND_CONTEXT_MISMATCH" }, { status: 409 });
  const credential = await resolveDurableProviderKey(authz.workspaceId, "replicate");
  if (!credential) return noStoreJson({ success: false, code: "DURABLE_REPLICATE_CREDENTIAL_REQUIRED", error: "Async generation requires a Workspace-stored Replicate key; transient request headers are not accepted." }, { status: 409 });
  const result = await productionGenerationExecution(credential).execute({ workspaceId: authz.workspaceId, userId: authz.userId, intentId, rawPrompt: parsed.data.prompt, sourceUrls, brandReferenceUrls: brandContext.referenceUrls, idempotencyKey: key });
  const status = result.kind === "accepted" ? 202 : result.kind === "not_found" ? 404 : result.kind === "invalid" || result.kind === "expired" ? 409 : 503;
  return noStoreJson({ success: result.kind === "accepted", result }, { status });
});
