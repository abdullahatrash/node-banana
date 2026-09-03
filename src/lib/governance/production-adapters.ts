import { z } from "zod";
import { deleteObjectFromS3 } from "@/lib/storage";
import { getAsset, softDeleteAsset, softDeletePrompt } from "@/lib/studio/repository";
import { deleteSocialPost } from "@/lib/social/repository";
import type { GovernanceDeletionAdapter, GovernanceDeletionSystemOutcome } from "./deletion-worker";
import type { GovernanceSafetyRevalidationPort } from "./safety-appeal-worker";
import { GOVERNANCE_REGION_ROUTES, requireGovernanceRegionRoute } from "./region-enforcement";

const deletionOutcome = z.discriminatedUnion("state", [
  z.object({ state: z.enum(["deleted", "not_found"]), evidenceRef: z.string().min(1).max(500) }).strict(),
  z.object({ state: z.literal("retained"), evidenceRef: z.string().min(1).max(500), reason: z.string().min(1).max(500) }).strict(),
  z.object({ state: z.literal("delayed"), retryAt: z.string().datetime({ offset: true }), reason: z.string().min(1).max(500) }).strict(),
  z.object({ state: z.enum(["failed_known", "outcome_unknown"]), reason: z.string().min(1).max(500) }).strict(),
]);

const safetyOutcome = z.object({
  outcome: z.enum(["allowed", "blocked"]),
  currentPolicyVersion: z.string().min(1).max(200),
  evidenceRef: z.string().min(1).max(500),
  safeExplanation: z.string().min(1).max(1_000),
}).strict();

async function configuredAdapterRequest(input: {
  url: string | undefined;
  secret: string | undefined;
  path: string;
  body: Record<string, unknown>;
}): Promise<unknown | null> {
  if (!input.url?.trim() || !input.secret?.trim()) return null;
  const endpoint = new URL(input.path, input.url);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${input.secret}`, "content-type": "application/json" },
    body: JSON.stringify(input.body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Governance adapter returned HTTP ${response.status}.`);
  return response.json();
}

/** Concrete first-party deletion plus a configured adapter for backup/log systems. */
export interface GovernanceEvidenceDeletionPort {
  delete(input: { workspaceId: string; resourceKind: string; resourceId: string; idempotencyKey: string }): Promise<GovernanceDeletionSystemOutcome>;
}

export class ConfiguredGovernanceEvidenceDeletionPort implements GovernanceEvidenceDeletionPort {
  async delete(input: { workspaceId: string; resourceKind: string; resourceId: string; idempotencyKey: string }): Promise<GovernanceDeletionSystemOutcome> {
    const response = await configuredAdapterRequest({
      url: process.env.GOVERNANCE_PRIMARY_EVIDENCE_DELETION_URL,
      secret: process.env.GOVERNANCE_PRIMARY_EVIDENCE_DELETION_SECRET,
      path: "/v1/evidence/delete",
      body: input,
    });
    if (!response) return { state: "failed_known", reason: "PRIMARY_EVIDENCE_DELETION_ADAPTER_NOT_CONFIGURED" };
    const parsed = deletionOutcome.safeParse(response);
    return parsed.success ? parsed.data : { state: "outcome_unknown", reason: "PRIMARY_EVIDENCE_DELETION_RESPONSE_INVALID" };
  }
}

export class ProductionGovernanceDeletionAdapter implements GovernanceDeletionAdapter {
  constructor(private readonly evidence: GovernanceEvidenceDeletionPort = new ConfiguredGovernanceEvidenceDeletionPort()) {}

  async delete(input: Parameters<GovernanceDeletionAdapter["delete"]>[0]): Promise<GovernanceDeletionSystemOutcome> {
    await requireGovernanceRegionRoute({
      workspaceId: input.workspaceId,
      route: GOVERNANCE_REGION_ROUTES.deletion,
      configuredRegion: process.env.GOVERNANCE_DELETION_REGION ?? process.env.APP_DATA_REGION,
    });
    if (input.system === "primary") return this.deletePrimary(input);
    const response = await configuredAdapterRequest({
      url: process.env.GOVERNANCE_DELETION_ADAPTER_URL,
      secret: process.env.GOVERNANCE_DELETION_ADAPTER_SECRET,
      path: "/v1/delete",
      body: input,
    });
    if (!response) return { state: "failed_known", reason: "DELETION_SYSTEM_ADAPTER_NOT_CONFIGURED" };
    const parsed = deletionOutcome.safeParse(response);
    return parsed.success ? parsed.data : { state: "outcome_unknown", reason: "DELETION_SYSTEM_RESPONSE_INVALID" };
  }

  private async deletePrimary(input: Parameters<GovernanceDeletionAdapter["delete"]>[0]): Promise<GovernanceDeletionSystemOutcome> {
    if (input.resourceKind === "media" || input.resourceKind === "asset") {
      const asset = await getAsset(input.workspaceId, input.resourceId);
      if (!asset) return { state: "not_found", evidenceRef: `primary:${input.idempotencyKey}:absent` };
      if (asset.storageProvider === "s3" && asset.storageKey) await deleteObjectFromS3({ key: asset.storageKey });
      const deleted = await softDeleteAsset(input.workspaceId, input.resourceId);
      return deleted
        ? { state: "deleted", evidenceRef: `primary:${input.idempotencyKey}:asset` }
        : { state: "not_found", evidenceRef: `primary:${input.idempotencyKey}:asset-absent` };
    }
    if (input.resourceKind === "prompt") {
      const deleted = await softDeletePrompt(input.workspaceId, input.resourceId);
      return deleted
        ? { state: "deleted", evidenceRef: `primary:${input.idempotencyKey}:prompt` }
        : { state: "not_found", evidenceRef: `primary:${input.idempotencyKey}:prompt-absent` };
    }
    if (input.resourceKind === "social_post" || input.resourceKind === "calendar_plan") {
      try {
        await deleteSocialPost(input.workspaceId, input.resourceId);
        return { state: "deleted", evidenceRef: `primary:${input.idempotencyKey}:social-post` };
      } catch (error) {
        return { state: "failed_known", reason: error instanceof Error ? error.name : "SOCIAL_POST_DELETE_FAILED" };
      }
    }
    if (["consent_evidence", "security_evidence", "billing_tax_evidence", "provider_diagnostic", "support_attachment"].includes(input.resourceKind)) {
      try {
        return await this.evidence.delete({ workspaceId: input.workspaceId, resourceKind: input.resourceKind, resourceId: input.resourceId, idempotencyKey: input.idempotencyKey });
      } catch (error) {
        return { state: "failed_known", reason: error instanceof Error ? error.name : "EVIDENCE_DELETE_FAILED" };
      }
    }
    return { state: "failed_known", reason: "PRIMARY_RESOURCE_KIND_UNSUPPORTED" };
  }
}

/** Registered production safety-policy bridge; absence is explicit and fail-closed. */
export class ProductionGovernanceSafetyRevalidationAdapter implements GovernanceSafetyRevalidationPort {
  async revalidate(input: Parameters<GovernanceSafetyRevalidationPort["revalidate"]>[0]) {
    const response = await configuredAdapterRequest({
      url: process.env.GOVERNANCE_SAFETY_REVALIDATION_URL,
      secret: process.env.GOVERNANCE_SAFETY_REVALIDATION_SECRET,
      path: "/v1/revalidate",
      body: input,
    });
    if (!response) return { outcome: "blocked" as const, currentPolicyVersion: "unconfigured", evidenceRef: "revalidation-adapter-unconfigured", safeExplanation: "Current-policy revalidation is not configured." };
    const parsed = safetyOutcome.safeParse(response);
    return parsed.success ? parsed.data : { outcome: "blocked" as const, currentPolicyVersion: "invalid-response", evidenceRef: "revalidation-response-invalid", safeExplanation: "Current-policy revalidation returned invalid evidence." };
  }
}
