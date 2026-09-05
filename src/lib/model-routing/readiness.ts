import type { GenerationCapability } from "./types";

export const GENERATION_CAPABILITIES: readonly GenerationCapability[] = [
  "text_generation",
  "text_to_image",
  "image_to_image",
  "text_to_video",
  "image_to_video",
  "video_to_video",
];

export interface GenerationReadiness {
  schema: "generation-readiness/v1";
  qualifiedModelCount: number;
  qualifiedCapabilities: GenerationCapability[];
  gates: {
    acceptedBrand: boolean;
    canonicalMediaStorage: boolean;
    processingRegion: boolean;
    byokCredential: boolean;
    managedCredential: boolean;
    managedCreditRate: boolean;
  };
}

export type ManagedGenerationReadinessGate =
  | "qualifiedModel"
  | "acceptedBrand"
  | "canonicalMediaStorage"
  | "processingRegion"
  | "managedCredential"
  | "managedCreditRate";

export interface ManagedGenerationReadiness {
  ready: boolean;
  blockers: ManagedGenerationReadinessGate[];
  qualifiedCapabilities: GenerationCapability[];
}

type ReadinessModel = {
  capabilities: readonly GenerationCapability[];
  qualification: { status: "qualified" | "unqualified" };
};

export function buildGenerationReadiness(input: {
  catalog: readonly ReadinessModel[];
  acceptedBrand: boolean;
  canonicalMediaStorage: boolean;
  processingRegion: boolean;
  byokCredential: boolean;
  managedCredential: boolean;
  managedCreditRate: boolean;
}): GenerationReadiness {
  const qualified = input.catalog.filter((model) => model.qualification.status === "qualified");
  const supported = new Set(qualified.flatMap((model) => model.capabilities));

  return {
    schema: "generation-readiness/v1",
    qualifiedModelCount: qualified.length,
    qualifiedCapabilities: GENERATION_CAPABILITIES.filter((capability) => supported.has(capability)),
    gates: {
      acceptedBrand: input.acceptedBrand,
      canonicalMediaStorage: input.canonicalMediaStorage,
      processingRegion: input.processingRegion,
      byokCredential: input.byokCredential,
      managedCredential: input.managedCredential,
      managedCreditRate: input.managedCreditRate,
    },
  };
}

/** Projects the safe, user-actionable gates for workspace-funded Replicate execution. */
export function projectManagedGenerationReadiness(
  readiness: GenerationReadiness,
): ManagedGenerationReadiness {
  const blockers: ManagedGenerationReadinessGate[] = [];

  if (readiness.qualifiedCapabilities.length === 0) blockers.push("qualifiedModel");
  if (!readiness.gates.acceptedBrand) blockers.push("acceptedBrand");
  if (!readiness.gates.canonicalMediaStorage) blockers.push("canonicalMediaStorage");
  if (!readiness.gates.processingRegion) blockers.push("processingRegion");
  if (!readiness.gates.managedCredential) blockers.push("managedCredential");
  if (!readiness.gates.managedCreditRate) blockers.push("managedCreditRate");

  return {
    ready: blockers.length === 0,
    blockers,
    qualifiedCapabilities: readiness.qualifiedCapabilities,
  };
}
