import { and, desc, eq } from "drizzle-orm";
import { listProviderKeys, resolveManagedProviderKey } from "@/lib/byok/repository";
import { getDb } from "@/lib/db";
import { brandProfiles } from "@/lib/db/schema";
import { canUseS3Storage } from "@/lib/storage";
import { PRODUCTION_GENERATION_REGIONS } from "./production";
import { buildGenerationReadiness, type GenerationReadiness } from "./readiness";
import type { ModelDescriptor } from "./types";

const READINESS_MODEL = {
  provider: "replicate" as const,
  model: "readiness-probe",
  version: "readiness-probe",
  inputSchemaDigest: `sha256:${"0".repeat(64)}` as const,
};

function hasManagedCreditRate(environment: NodeJS.ProcessEnv): boolean {
  const value = Number(environment.MANAGED_GENERATION_USD_PER_CREDIT);
  return Number.isFinite(value) && value > 0 && value <= 100;
}

async function hasAcceptedBrand(workspaceId: string): Promise<boolean> {
  const [brand] = await getDb()
    .select({ acceptedAt: brandProfiles.acceptedAt })
    .from(brandProfiles)
    .where(and(eq(brandProfiles.workspaceId, workspaceId), eq(brandProfiles.status, "active")))
    .orderBy(desc(brandProfiles.revision))
    .limit(1);
  return Boolean(brand?.acceptedAt);
}

/** Returns only booleans and catalog metadata; credentials and governance evidence never cross this boundary. */
export async function readProductionGenerationReadiness(
  workspaceId: string,
  catalog: readonly ModelDescriptor[],
  environment: NodeJS.ProcessEnv = process.env,
  at = new Date(),
): Promise<GenerationReadiness> {
  const [brandResult, keysResult, regionResult] = await Promise.allSettled([
    hasAcceptedBrand(workspaceId),
    listProviderKeys(workspaceId),
    PRODUCTION_GENERATION_REGIONS.admit({ workspaceId, model: READINESS_MODEL, at }),
  ]);

  const keys = keysResult.status === "fulfilled" ? keysResult.value : [];
  const region = regionResult.status === "fulfilled" ? regionResult.value : null;

  return buildGenerationReadiness({
    catalog,
    acceptedBrand: brandResult.status === "fulfilled" && brandResult.value,
    canonicalMediaStorage: canUseS3Storage(),
    processingRegion: region?.kind === "admitted",
    byokCredential: keys.some((key) => key.provider === "replicate" && key.lastValidatedAt !== null),
    managedCredential: resolveManagedProviderKey("replicate", environment) !== null,
    managedCreditRate: hasManagedCreditRate(environment),
  });
}
