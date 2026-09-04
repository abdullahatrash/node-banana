import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import type { GovernanceRepository } from "./types";
import { GOVERNANCE_REGION_ROUTE_CATALOG } from "./region-route-catalog";

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
  sources: Array<{ url: string; digest: string; checkedAt: string }>;
  signature: string;
}

export type GovernanceRegionDeploymentEvidenceUnsigned = Omit<GovernanceRegionDeploymentEvidence, "signature">;

export function signGovernanceRegionDeploymentEvidence(
  evidence: GovernanceRegionDeploymentEvidenceUnsigned,
  key: Uint8Array,
): GovernanceRegionDeploymentEvidence {
  if (key.byteLength < 32) throw new Error("GOVERNANCE_REGION_SIGNING_KEY_INVALID");
  return {
    ...evidence,
    signature: createHmac("sha256", key).update(canonicalJson(evidence)).digest("base64url"),
  };
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
  sources: Array<{ url: string; digest: string; checkedAt: string }>;
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
    if (!key || key.byteLength < 32) return { status: "pending" as const, reason: "UNCONFIGURED_TRUST_ROOT" as const };
    const issuedAt = exactDate(input.evidence.issuedAt);
    const expiresAt = exactDate(input.evidence.expiresAt);
    const sourceDates = input.evidence.sources.map((source) => exactDate(source.checkedAt));
    if (!issuedAt || !expiresAt || issuedAt > input.evaluatedAt || expiresAt <= input.evaluatedAt || expiresAt.getTime() - issuedAt.getTime() > 90 * 24 * 60 * 60_000) {
      return { status: "pending" as const, reason: "EXPIRED_EVIDENCE" as const };
    }
    const routeKinds = new Set(input.evidence.routes.map((route) => route.kind));
    const routeKeys = new Set(input.evidence.routes.map((route) => `${route.kind}:${route.routeId}`));
    const allAuthoritativeRoutesCovered = GOVERNANCE_REGION_ROUTE_CATALOG.every((required) =>
      input.evidence.routes.some((route) => route.kind === required.kind && route.routeId === required.routeId),
    );
    const assetStorageRoute = GOVERNANCE_REGION_ROUTE_CATALOG.find((route) => route.key === "assetStorage")!;
    const primaryRegionMatches = input.evidence.routes.some((route) =>
      route.kind === assetStorageRoute.kind && route.routeId === assetStorageRoute.routeId && route.region === input.region,
    );
    const validSources = input.evidence.sources.length > 0 && input.evidence.sources.every((source, index) => {
      try {
        return new URL(source.url).protocol === "https:"
          && /^sha256:[a-f0-9]{64}$/.test(source.digest)
          && sourceDates[index] !== null
          && sourceDates[index]! <= issuedAt
          && issuedAt.getTime() - sourceDates[index]!.getTime() <= 30 * 24 * 60 * 60_000;
      } catch {
        return false;
      }
    });
    if (
      input.evidence.schema !== "governance-region-deployment-evidence/v1" ||
      input.evidence.region !== input.region ||
      !primaryRegionMatches ||
      REQUIRED_REGION_ROUTE_KINDS.some((kind) => !routeKinds.has(kind)) ||
      !allAuthoritativeRoutesCovered ||
      routeKeys.size !== input.evidence.routes.length ||
      !validSources
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
        sources: structuredClone(input.evidence.sources),
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
    const exactRoute = evidence.routes.some((route) => route.kind === input.kind && route.routeId === input.routeId && route.region === input.configuredRegion);
    return exactRoute
      ? { allowed: true as const, policyApplied: true as const, evidenceDigest: evidence.evidenceDigest }
      : { allowed: false as const, reason: "REGION_ROUTE_NOT_ALLOWLISTED" as const };
  }
}
