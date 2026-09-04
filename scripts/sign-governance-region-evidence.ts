import "./_load-env";

import { readFile } from "node:fs/promises";

import { governanceCommandSchema } from "@/lib/governance/command-schema";
import {
  ConfiguredGovernanceRegionVerifier,
  signGovernanceRegionDeploymentEvidence,
  type GovernanceRegionDeploymentEvidenceUnsigned,
} from "@/lib/governance/region-policy";
import { GOVERNANCE_REGION_ROUTE_CATALOG } from "@/lib/governance/region-route-catalog";

function configuredRegion(routeKey: string) {
  const appRegion = process.env.APP_DATA_REGION?.trim();
  const assetStorageRegion = process.env.S3_REGION?.trim();
  const values: Record<string, string | undefined> = {
    assetStorage: assetStorageRegion,
    workspaceImportStorage: process.env.GOVERNANCE_IMPORT_STORAGE_REGION?.trim() || appRegion,
    governanceExportStorage: process.env.GOVERNANCE_EXPORT_STORAGE_REGION,
    assetProcessing: appRegion,
    publishing: appRegion,
    workspaceImportProcessing: process.env.GOVERNANCE_IMPORT_PROCESSING_REGION?.trim() || appRegion,
    replicateProcessing: process.env.PROVIDER_REGION_REPLICATE,
    backup: appRegion,
    logging: appRegion,
    deletion: process.env.GOVERNANCE_DELETION_REGION?.trim() || appRegion,
  };
  return values[routeKey]?.trim() || "REVIEW_REQUIRED";
}

function trustKeys() {
  const parsed = JSON.parse(process.env.GOVERNANCE_REGION_TRUST_KEYS || "{}") as Record<string, unknown>;
  return new Map(Object.entries(parsed).flatMap(([keyId, encoded]) => {
    if (typeof encoded !== "string") return [];
    const key = Buffer.from(encoded, "base64");
    return key.byteLength >= 32 ? [[keyId, key] as const] : [];
  }));
}

function template(): GovernanceRegionDeploymentEvidenceUnsigned {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
  const keys = trustKeys();
  return {
    schema: "governance-region-deployment-evidence/v1",
    keyId: keys.keys().next().value || "REVIEW_REQUIRED",
    deploymentId: "local-development",
    region: configuredRegion("assetStorage"),
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    routes: GOVERNANCE_REGION_ROUTE_CATALOG.map((route) => ({
      kind: route.kind,
      routeId: route.routeId,
      region: configuredRegion(route.key),
    })),
    sources: [{ url: "https://REVIEW_REQUIRED", digest: `sha256:${"0".repeat(64)}`, checkedAt: now.toISOString() }],
  };
}

async function main() {
  if (process.argv.includes("--template")) {
    process.stdout.write(`${JSON.stringify(template(), null, 2)}\n`);
    return;
  }
  const inputPath = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  if (!inputPath) throw new Error("REGION_EVIDENCE_INPUT_REQUIRED");
  const raw = JSON.parse(await readFile(inputPath, "utf8")) as Record<string, unknown>;
  if (JSON.stringify(raw).includes("REVIEW_REQUIRED")) throw new Error("REGION_EVIDENCE_REVIEW_REQUIRED");
  const rawSources = Array.isArray(raw.sources) ? raw.sources : [];
  if (rawSources.some((source) => typeof source === "object" && source !== null && (source as { digest?: unknown }).digest === `sha256:${"0".repeat(64)}`)) {
    throw new Error("REGION_EVIDENCE_REVIEW_REQUIRED");
  }
  const placeholderSignature = Buffer.alloc(32).toString("base64url");
  const command = governanceCommandSchema.parse({
    type: "set_region_policy",
    region: raw.region,
    verificationEvidence: { ...raw, signature: placeholderSignature },
    stepUpToken: "operator-preflight",
  });
  if (command.type !== "set_region_policy") throw new Error("REGION_EVIDENCE_INPUT_INVALID");
  const { signature: _placeholder, ...unsigned } = command.verificationEvidence;
  const keys = trustKeys();
  const key = keys.get(unsigned.keyId);
  if (!key) throw new Error("REGION_EVIDENCE_TRUST_KEY_MISSING");
  const evidence = signGovernanceRegionDeploymentEvidence(unsigned, key);
  const verified = await new ConfiguredGovernanceRegionVerifier(keys).verify({
    workspaceId: "operator-preflight",
    region: evidence.region,
    evidence,
    evaluatedAt: new Date(),
  });
  if (verified.status !== "verified") throw new Error(`REGION_EVIDENCE_${verified.reason}`);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "REGION_EVIDENCE_SIGNING_FAILED"}\n`);
  process.exitCode = 1;
});
