import type { GovernanceResource } from "@/lib/governance/types";
import type { GovernanceVerifiedRegionEvidence } from "@/lib/governance/region-policy";
import type { ExactModelRef } from "./types";

export interface GenerationRegionAdmission {
  policyId: string;
  policyVersion: number;
  evidenceDigest: `sha256:${string}`;
  region: string;
  routeId: string;
  evidenceExpiresAt: Date;
}

type RegionPolicyBody = { region: string; verified: boolean; verifiedEvidence?: GovernanceVerifiedRegionEvidence };
export interface GenerationRegionRepository {
  getResource<T>(input: { workspaceId: string; kind: "data_region_policy"; id: "active" }): Promise<GovernanceResource<T> | null>;
}
export interface GenerationRegionAuthority {
  admit(input: { workspaceId: string; model: ExactModelRef; at: Date }): Promise<{ kind: "admitted"; evidence: GenerationRegionAdmission } | { kind: "denied"; code: string }>;
  revalidate(input: { workspaceId: string; evidence: GenerationRegionAdmission; model: ExactModelRef; at: Date }): Promise<{ kind: "admitted" } | { kind: "denied"; code: string }>;
}

export const DENYING_GENERATION_REGION_AUTHORITY: GenerationRegionAuthority = {
  admit: async () => ({ kind: "denied", code: "VERIFIED_PROCESSING_REGION_REQUIRED" }),
  revalidate: async () => ({ kind: "denied", code: "VERIFIED_PROCESSING_REGION_REQUIRED" }),
};

/** Exact governance-policy admission. A catalog region label is never authority. */
export class GovernanceGenerationRegionAuthority implements GenerationRegionAuthority {
  constructor(private readonly repository: GenerationRegionRepository, private readonly configuredRegion: (provider: ExactModelRef["provider"]) => string | null) {}

  async admit(input: Parameters<GenerationRegionAuthority["admit"]>[0]) {
    const result = await this.read(input.workspaceId, input.model, input.at);
    return result.kind === "denied" ? result : { kind: "admitted" as const, evidence: result.evidence };
  }

  async revalidate(input: Parameters<GenerationRegionAuthority["revalidate"]>[0]) {
    const result = await this.read(input.workspaceId, input.model, input.at);
    if (result.kind === "denied") return result;
    const pinned = input.evidence; const current = result.evidence;
    return pinned.policyId === current.policyId && pinned.policyVersion === current.policyVersion && pinned.evidenceDigest === current.evidenceDigest && pinned.region === current.region && pinned.routeId === current.routeId && pinned.evidenceExpiresAt.getTime() === current.evidenceExpiresAt.getTime()
      ? { kind: "admitted" as const }
      : { kind: "denied" as const, code: "PROCESSING_REGION_EVIDENCE_CHANGED" };
  }

  private async read(workspaceId: string, model: ExactModelRef, at: Date): Promise<{ kind: "admitted"; evidence: GenerationRegionAdmission } | { kind: "denied"; code: string }> {
    const configuredRegion = this.configuredRegion(model.provider)?.trim();
    if (!configuredRegion) return { kind: "denied", code: "PROCESSING_REGION_UNCONFIGURED" };
    const policy = await this.repository.getResource<RegionPolicyBody>({ workspaceId, kind: "data_region_policy", id: "active" });
    if (!policy || policy.status !== "active" || !policy.body.verified || !policy.body.verifiedEvidence) return { kind: "denied", code: "VERIFIED_PROCESSING_REGION_REQUIRED" };
    const verified = policy.body.verifiedEvidence; const expiresAt = new Date(verified.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= at) return { kind: "denied", code: "PROCESSING_REGION_EVIDENCE_EXPIRED" };
    const routeId = `provider:${model.provider}`;
    const route = verified.routes.find((item) => item.kind === "processing" && item.routeId === routeId && item.region === configuredRegion);
    if (!route || !/^sha256:[a-f0-9]{64}$/.test(verified.evidenceDigest)) return { kind: "denied", code: "PROCESSING_REGION_ROUTE_NOT_VERIFIED" };
    return { kind: "admitted", evidence: { policyId: policy.id, policyVersion: policy.version, evidenceDigest: verified.evidenceDigest as `sha256:${string}`, region: configuredRegion, routeId, evidenceExpiresAt: expiresAt } };
  }
}
