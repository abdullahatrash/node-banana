import type { z } from "zod";
import type { BrandSourceRecord } from "../repository";
import type {
  ActivationArtifactV1,
  BrandProfileV1,
  OnboardingAnswersV1,
} from "../schemas";
import type { ImmutableBrandContext } from "@/lib/model-routing/types";

export type StructuredGenerationKind = "brand_profile" | "activation_artifact";

export interface StructuredGenerationRequest {
  kind: StructuredGenerationKind;
  schema: z.ZodType<unknown>;
  schemaName: string;
  schemaDescription: string;
  system: string;
  prompt: string;
  admission?: {
    workspaceId: string;
    userId: string;
    idempotencyKey: string;
    contentLanguage: "ar" | "en" | "mixed";
    arabicVariety: "msa" | null;
    brand: {
      profileId: string;
      revision: number;
      acceptedAt: Date;
      profileDigest: `sha256:${string}`;
      context: ImmutableBrandContext;
      referenceUrls: Array<{ assetId: string; url: string }>;
    };
  };
}

export interface StructuredGenerationClient {
  readonly requiresAdmission?: boolean;
  generate(request: StructuredGenerationRequest): Promise<unknown>;
}

export interface BrandProfileGenerationInput {
  source: BrandSourceRecord;
  answers: OnboardingAnswersV1;
  contentLanguage: string;
}

export interface ActivationArtifactGenerationInput {
  brandProfileId: string;
  profile: BrandProfileV1;
  control?: {
    workspaceId: string;
    userId: string;
    idempotencyKey: string;
    revision: number;
    acceptedAt: Date;
  };
}

export interface BrandProfileGenerator {
  generateProfile(input: BrandProfileGenerationInput): Promise<BrandProfileV1>;
  generateActivationArtifact(
    input: ActivationArtifactGenerationInput,
  ): Promise<ActivationArtifactV1>;
}

export class InvalidStructuredOutputError extends Error {
  constructor(readonly issues: string[]) {
    super("The model returned invalid structured output.");
    this.name = "InvalidStructuredOutputError";
  }
}

export class BrandProfileGenerationError extends Error {
  constructor(
    readonly code:
      | "BRAND_PROFILE_GENERATION_FAILED"
      | "BRAND_PROFILE_OUTPUT_INVALID"
      | "ACTIVATION_GENERATION_FAILED"
      | "ACTIVATION_OUTPUT_INVALID"
      | "MODEL_CONFIGURATION_UNAVAILABLE"
      | "ADMITTED_GENERATION_UNAVAILABLE"
      | "ADMITTED_GENERATION_PENDING",
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "BrandProfileGenerationError";
  }
}
