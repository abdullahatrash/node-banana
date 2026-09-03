import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import type { GovernanceRepository } from "./types";

export const REQUIRED_REGION_ROUTE_KINDS = [
  "primary_storage",
  "processing",
  "backup",
  "logging",
  "deletion",
] as const;

export type GovernanceRegionRouteKind = (typeof REQUIRED_REGION_ROUTE_KINDS)[number];

export interface GovernanceRegionDeploymentEvidence {
  schema: "governance-region-deployment-evidence/v1";
  keyId: string;
  deploymentId: string;
  region: string;
  issuedAt: string;
  expiresAt: string;
  routes: Array<{ kind: GovernanceRegionRouteKind; routeId: string; region: string }>;
  signature: string;
}

export interface GovernanceVerifiedRegionEvidence {
  schema: "governance-verified-region-evidence/v1";
  evidenceDigest: string;
  keyId: string;
  deploymentId: string;
  region: string;
  issuedAt: string;
  expiresAt: string;
  routes: Array<{ kind: GovernanceRegionRouteKind; routeId: string; region: string }>;
  verifiedAt: string;
}

export interface GovernanceRegionVerificationPort {
  verify(input: {
    workspaceId: string;
    region: string;
    evidence: GovernanceRegionDeploymentEvidence;
    evaluatedAt: Date;
  }): Promise<
    | { status: "verified"; evidence: GovernanceVerifiedRegionEvidence }
    | { status: "pending"; reason: "UNCONFIGURED_TRUST_ROOT" | "INVALID_SIGNATURE" | "INVALID_SCOPE" | "EXPIRED_EVIDENCE" }
  >;
}

function evidencePayload(evidence: GovernanceRegionDeploymentEvidence) {
  const { signature: _signature, ...payload } = evidence;
  return payload;
}

function exactDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? date : null;
}

export class ConfiguredGovernanceRegionVerifier implements GovernanceRegionVerificationPort {
  constructor(private readonly trustedKeys: ReadonlyMap<string, Uint8Array>) {}

  async verify(input: Parameters<GovernanceRegionVerificationPort["verify"]>[0]) {
    const key = this.trustedKeys.get(input.evidence.keyId);
    if (!key) return { status: "pending" as const, reason: "UNCONFIGURED_TRUST_ROOT" as const };
    const issuedAt = exactDate(input.evidence.issuedAt);
    const expiresAt = exactDate(input.evidence.expiresAt);
    if (!issuedAt || !expiresAt || issuedAt > input.evaluatedAt || expiresAt <= input.evaluatedAt) {
      return { status: "pending" as const, reason: "EXPIRED_EVIDENCE" as const };
    }
    const routeKinds = new Set(input.evidence.routes.map((route) => route.kind));
    if (
      input.evidence.schema !== "governance-region-deployment-evidence/v1" ||
      input.evidence.region !== input.region ||
      input.evidence.routes.some((route) => route.region !== input.region) ||
      REQUIRED_REGION_ROUTE_KINDS.some((kind) => !routeKinds.has(kind))
    ) {
      return { status: "pending" as const, reason: "INVALID_SCOPE" as const };
    }
    const actual = Buffer.from(input.evidence.signature, "base64url");
    const expected = createHmac("sha256", key).update(canonicalJson(evidencePayload(input.evidence))).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return { status: "pending" as const, reason: "INVALID_SIGNATURE" as const };
    }
    return {
      status: "verified" as const,
      evidence: {
        schema: "governance-verified-region-evidence/v1" as const,
        evidenceDigest: canonicalDigest(evidencePayload(input.evidence)),
        keyId: input.evidence.keyId,
        deploymentId: input.evidence.deploymentId,
        region: input.region,
        issuedAt: input.evidence.issuedAt,
        expiresAt: input.evidence.expiresAt,
        routes: structuredClone(input.evidence.routes),
        verifiedAt: input.evaluatedAt.toISOString(),
      },
    };
  }
}

export const UNCONFIGURED_GOVERNANCE_REGION_VERIFIER: GovernanceRegionVerificationPort = {
  verify: async () => ({ status: "pending", reason: "UNCONFIGURED_TRUST_ROOT" }),
};

export class GovernanceRegionAdmissionService {
  constructor(private readonly repository: GovernanceRepository) {}

  async admit(input: { workspaceId: string; kind: GovernanceRegionRouteKind; routeId: string; configuredRegion: string; evaluatedAt: Date }) {
    const policy = await this.repository.getResource<{ region: string; verified: boolean; verifiedEvidence?: GovernanceVerifiedRegionEvidence }>({ workspaceId: input.workspaceId, kind: "data_region_policy", id: "active" });
    if (!policy) return { allowed: true as const, policyApplied: false as const };
    const evidence = policy.body.verifiedEvidence;
    if (policy.status !== "active" || !policy.body.verified || !evidence) return { allowed: false as const, reason: "REGION_POLICY_UNVERIFIED" as const };
    if (new Date(evidence.expiresAt) <= input.evaluatedAt) return { allowed: false as const, reason: "REGION_EVIDENCE_EXPIRED" as const };
    const exactRoute = evidence.routes.some((route) => route.kind === input.kind && route.routeId === input.routeId && route.region === input.configuredRegion && route.region === policy.body.region);
    return exactRoute
      ? { allowed: true as const, policyApplied: true as const, evidenceDigest: evidence.evidenceDigest }
      : { allowed: false as const, reason: "REGION_ROUTE_NOT_ALLOWLISTED" as const };
  }
}
