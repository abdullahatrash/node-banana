import { getDb } from "@/lib/db";
import { DrizzleGovernanceRepository } from "./postgres-repository";
import { GovernanceService } from "./service";
import { GovernanceExportWorker, S3GovernanceExportStore } from "./export-worker";
import { DrizzleGovernanceMembershipPort } from "./membership-postgres";
import { ApplicationGovernanceBulkCapabilityPort, DrizzleGovernanceBulkAuthorizationPort, GovernanceBulkWorker } from "./bulk-worker";
import { GovernanceImportWorker } from "./import-worker";
import { GovernanceApprovalDeadlineWorker } from "./approval-worker";
import { ConfiguredGovernanceRegionVerifier, GovernanceRegionAdmissionService, type GovernanceRegionRouteKind } from "./region-policy";
import { GovernanceDeletionWorker } from "./deletion-worker";
import { GovernanceSafetyAppealWorker } from "./safety-appeal-worker";
import { HmacGovernanceImportManifestVerifier } from "./import-manifest";
import { DrizzleGovernancePortableDataPort } from "./portability";

function regionTrustKeys(): Map<string, Uint8Array> {
  const keys = new Map<string, Uint8Array>();
  try {
    const configured = JSON.parse(process.env.GOVERNANCE_REGION_TRUST_KEYS ?? "{}") as Record<string, string>;
    for (const [keyId, encoded] of Object.entries(configured)) {
      const key = Buffer.from(encoded, "base64");
      if (key.length >= 32) keys.set(keyId, key);
    }
  } catch {
    // Invalid or absent configuration intentionally leaves verification fail-closed.
  }
  return keys;
}

function importTrustKeys(): Map<string, Uint8Array> {
  const keys = new Map<string, Uint8Array>();
  const ownExportKey = Buffer.from(process.env.GOVERNANCE_EXPORT_SIGNING_KEY ?? "", "base64");
  if (ownExportKey.length === 32) keys.set("workspace-export-signing-v1", ownExportKey);
  try {
    const configured = JSON.parse(process.env.GOVERNANCE_IMPORT_TRUST_KEYS ?? "{}") as Record<string, string>;
    for (const [keyId, encoded] of Object.entries(configured)) {
      const key = Buffer.from(encoded, "base64");
      if (key.length >= 32) keys.set(keyId, key);
    }
  } catch {
    // Missing or malformed trust configuration leaves imports fail-closed.
  }
  return keys;
}

export const PRODUCTION_GOVERNANCE_REPOSITORY = new DrizzleGovernanceRepository(getDb);
const PRODUCTION_GOVERNANCE_REGION_ADMISSION = new GovernanceRegionAdmissionService(PRODUCTION_GOVERNANCE_REPOSITORY);
export const PRODUCTION_GOVERNANCE_SERVICE = new GovernanceService(
  PRODUCTION_GOVERNANCE_REPOSITORY,
  undefined,
  new DrizzleGovernanceMembershipPort(getDb),
  new ConfiguredGovernanceRegionVerifier(regionTrustKeys()),
  new HmacGovernanceImportManifestVerifier(importTrustKeys()),
);

export async function admitProductionGovernanceRegionRoute(input: { workspaceId: string; kind: GovernanceRegionRouteKind; routeId: string; configuredRegion: string }) {
  return PRODUCTION_GOVERNANCE_REGION_ADMISSION.admit({ ...input, evaluatedAt: new Date() });
}

export function getProductionGovernanceExportWorker(): GovernanceExportWorker {
  return new GovernanceExportWorker(
    PRODUCTION_GOVERNANCE_REPOSITORY,
    new S3GovernanceExportStore(),
    {
      encryptionKeyBase64: process.env.GOVERNANCE_EXPORT_ENCRYPTION_KEY ?? "",
      signingKeyBase64: process.env.GOVERNANCE_EXPORT_SIGNING_KEY ?? "",
    },
    undefined,
    ({ workspaceId, routeId, configuredRegion }) => admitProductionGovernanceRegionRoute({ workspaceId, kind: "primary_storage", routeId, configuredRegion }),
    new DrizzleGovernancePortableDataPort(getDb),
  );
}

export function getProductionGovernanceBulkWorker(): GovernanceBulkWorker {
  return new GovernanceBulkWorker(
    PRODUCTION_GOVERNANCE_REPOSITORY,
    new DrizzleGovernanceBulkAuthorizationPort(),
    new ApplicationGovernanceBulkCapabilityPort(),
  );
}

export function getProductionGovernanceImportWorker(): GovernanceImportWorker {
  return new GovernanceImportWorker(
    PRODUCTION_GOVERNANCE_REPOSITORY,
    undefined,
    new DrizzleGovernancePortableDataPort(getDb),
  );
}

export function getProductionGovernanceApprovalDeadlineWorker(): GovernanceApprovalDeadlineWorker {
  return new GovernanceApprovalDeadlineWorker(PRODUCTION_GOVERNANCE_REPOSITORY);
}

export function getProductionGovernanceDeletionWorker(): GovernanceDeletionWorker {
  return new GovernanceDeletionWorker(PRODUCTION_GOVERNANCE_REPOSITORY);
}

export function getProductionGovernanceSafetyAppealWorker(): GovernanceSafetyAppealWorker {
  return new GovernanceSafetyAppealWorker(PRODUCTION_GOVERNANCE_REPOSITORY);
}
