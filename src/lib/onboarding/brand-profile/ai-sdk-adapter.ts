import type { z } from "zod";
import {
  activationArtifactV1Schema,
  brandProfileV1Schema,
  type ActivationArtifactV1,
  type BrandProfileV1,
} from "../schemas";
import { buildEvidenceCatalog, validateProfileEvidence } from "./evidence";
import type {
  ActivationArtifactGenerationInput,
  BrandProfileGenerationInput,
  BrandProfileGenerator,
  StructuredGenerationClient,
  StructuredGenerationRequest,
} from "./ports";
import {
  BrandProfileGenerationError,
  InvalidStructuredOutputError,
} from "./ports";
import {
  ACTIVATION_SYSTEM_PROMPT,
  BRAND_PROFILE_SYSTEM_PROMPT,
  buildActivationPrompt,
  buildBrandProfilePrompt,
  buildRepairPrompt,
} from "./prompt";
import { AdmittedOnboardingStructuredGenerationClient } from "./admitted-client";

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`);
}

const language = (value: string): "ar" | "en" | "mixed" => value.toLowerCase().startsWith("ar") ? "ar" : value.toLowerCase().startsWith("en") ? "en" : "mixed";

function deterministicDraftProfile(input: BrandProfileGenerationInput, evidence: ReturnType<typeof buildEvidenceCatalog>): BrandProfileV1 {
  const contentLanguage = language(input.contentLanguage);
  const companyName = input.answers.identity?.companyName ?? "Workspace brand";
  const localizedPending = contentLanguage === "ar" ? "هوية العلامة قيد التحليل من الأدلة التي وافق المستخدم على تقديمها." : "Brand identity pending analysis from evidence the user consented to submit.";
  const categories = input.answers.businessClassification?.categories ?? ["other" as const];
  return {
    schemaVersion: 1, contentLanguage, identity: { companyName, coreIdentity: localizedPending, logoAssetId: input.answers.identity?.logoAssetId ?? null },
    offering: categories, audiences: [{ name: input.answers.role?.role ?? "workspace team", description: localizedPending, weight: 100 }],
    problems: [], benefits: input.answers.goals?.expectedOutcomes ?? [], differentiators: [], mission: localizedPending, positioning: localizedPending, ownedSpace: localizedPending,
    businessModel: input.answers.businessClassification?.businessModel ?? "both", categories,
    voice: { descriptors: [contentLanguage === "ar" ? "واضح" : "clear"], do: [], doNot: [] }, prohibitedClaims: [], prohibitedTopics: [], competitors: [], contentAngles: [contentLanguage === "ar" ? "قدّم قيمة العلامة بوضوح" : "Present the brand value clearly"], uncertainties: [localizedPending], evidence: evidence.slice(0, 3).map(({ sourceId, excerptHash }) => ({ sourceId, excerptHash })), sourceIds: [input.source.id],
  };
}

function deterministicActivationArtifact(brandProfileId: string, profile: BrandProfileV1): ActivationArtifactV1 {
  const arabic = language(profile.contentLanguage) === "ar";
  return activationArtifactV1Schema.parse({
    schemaVersion: 1,
    contentLanguage: profile.contentLanguage,
    kind: "social_post",
    title: profile.contentAngles[0] ?? (arabic ? "فكرة محتوى أولى" : "First content idea"),
    hook: arabic ? "ابدأ برسالة واضحة تعكس قيمة علامتك." : "Start with a clear message that reflects your brand value.",
    body: arabic ? "حوّل هذه الفكرة إلى مسودة، ثم راجع الادعاءات والنبرة قبل النشر." : "Turn this idea into a draft, then review its claims and tone before publishing.",
    rationale: arabic ? "اقتراح محافظ مشتق من ملف العلامة الذي ينتظر موافقة صريحة." : "A conservative suggestion derived from the Brand Profile awaiting explicit approval.",
    suggestedFormats: [arabic ? "منشور اجتماعي" : "Social post"],
    brandProfileId,
  });
}

async function generateWithOneRepair<T>(input: {
  client: StructuredGenerationClient;
  request: StructuredGenerationRequest;
  schema: z.ZodType<T>;
  validate?: (value: T) => string[];
  invalidCode: "BRAND_PROFILE_OUTPUT_INVALID" | "ACTIVATION_OUTPUT_INVALID";
  failureCode: "BRAND_PROFILE_GENERATION_FAILED" | "ACTIVATION_GENERATION_FAILED";
}): Promise<T> {
  let prompt = input.request.prompt;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let output: unknown;
    let issues: string[] = [];

    try {
      const admission = input.request.admission
        ? { ...input.request.admission, idempotencyKey: `${input.request.admission.idempotencyKey}:attempt:${attempt + 1}` }
        : undefined;
      output = await input.client.generate({ ...input.request, prompt, admission });
    } catch (error) {
      if (error instanceof InvalidStructuredOutputError) {
        issues = error.issues;
      } else if (error instanceof BrandProfileGenerationError) {
        throw error;
      } else {
        throw new BrandProfileGenerationError(input.failureCode, true);
      }
    }

    if (issues.length === 0) {
      const parsed = input.schema.safeParse(output);
      if (parsed.success) {
        issues = input.validate?.(parsed.data) ?? [];
        if (issues.length === 0) return parsed.data;
      } else {
        issues = formatZodIssues(parsed.error);
      }
    }

    if (attempt === 0) {
      prompt = buildRepairPrompt(input.request.prompt, issues);
    }
  }

  throw new BrandProfileGenerationError(input.invalidCode, true);
}

export class ValidatedBrandProfileGenerator implements BrandProfileGenerator {
  constructor(private readonly client: StructuredGenerationClient) {}

  async generateProfile(input: BrandProfileGenerationInput): Promise<BrandProfileV1> {
    if (!input.source.cleanedText) {
      throw new BrandProfileGenerationError("BRAND_PROFILE_GENERATION_FAILED", false);
    }

    const evidence = buildEvidenceCatalog(input.source.id, input.source.cleanedText);
    if (evidence.length === 0) {
      throw new BrandProfileGenerationError("BRAND_PROFILE_GENERATION_FAILED", false);
    }

    if (this.client.requiresAdmission) {
      // The first Brand Profile cannot truthfully cite a pre-existing accepted
      // Brand. Create a conservative evidence-linked draft locally; provider
      // enhancement remains gated on explicit acceptance of an exact revision.
      return brandProfileV1Schema.parse(deterministicDraftProfile(input, evidence));
    }

    const prompt = buildBrandProfilePrompt({
      contentLanguage: input.contentLanguage,
      sourceLanguage: input.source.sourceLanguage,
      sourceId: input.source.id,
      evidence,
      answers: input.answers,
    });
    return generateWithOneRepair({
      client: this.client,
      request: {
        kind: "brand_profile",
        schema: brandProfileV1Schema,
        schemaName: "BrandProfileV1",
        schemaDescription: "A versioned, evidence-backed brand profile for human review.",
        system: BRAND_PROFILE_SYSTEM_PROMPT,
        prompt,
      },
      schema: brandProfileV1Schema,
      validate: (profile) => {
        const issues = validateProfileEvidence(profile, evidence);
        if (profile.contentLanguage !== input.contentLanguage) {
          issues.push(`contentLanguage: expected ${input.contentLanguage}`);
        }
        if (profile.sourceIds.length !== 1 || profile.sourceIds[0] !== input.source.id) {
          issues.push(`sourceIds: expected only ${input.source.id}`);
        }
        return issues;
      },
      invalidCode: "BRAND_PROFILE_OUTPUT_INVALID",
      failureCode: "BRAND_PROFILE_GENERATION_FAILED",
    });
  }

  async generateActivationArtifact(
    input: ActivationArtifactGenerationInput,
  ): Promise<ActivationArtifactV1> {
    const profile = brandProfileV1Schema.parse(input.profile);
    const prompt = buildActivationPrompt({
      brandProfileId: input.brandProfileId,
      profile,
    });
    let admission: StructuredGenerationRequest["admission"];
    if (this.client.requiresAdmission) {
      if (!input.control) throw new BrandProfileGenerationError("ADMITTED_GENERATION_UNAVAILABLE", false);
      if (input.control.status !== "active") return deterministicActivationArtifact(input.brandProfileId, profile);
      admission = { workspaceId: input.control.workspaceId, userId: input.control.userId, idempotencyKey: input.control.idempotencyKey, contentLanguage: language(profile.contentLanguage), arabicVariety: language(profile.contentLanguage) === "en" ? null : "msa", brand: { profileId: input.brandProfileId, revision: input.control.revision } };
    }

    return generateWithOneRepair({
      client: this.client,
      request: {
        kind: "activation_artifact",
        schema: activationArtifactV1Schema,
        schemaName: "ActivationArtifactV1",
        schemaDescription: "One editable, immediately useful content suggestion.",
        system: ACTIVATION_SYSTEM_PROMPT,
        prompt,
        admission,
      },
      schema: activationArtifactV1Schema,
      validate: (artifact) => {
        const issues: string[] = [];
        if (artifact.brandProfileId !== input.brandProfileId) {
          issues.push(`brandProfileId: expected ${input.brandProfileId}`);
        }
        if (artifact.contentLanguage !== profile.contentLanguage) {
          issues.push(`contentLanguage: expected ${profile.contentLanguage}`);
        }
        return issues;
      },
      invalidCode: "ACTIVATION_OUTPUT_INVALID",
      failureCode: "ACTIVATION_GENERATION_FAILED",
    });
  }
}

export function createConfiguredBrandProfileGenerator(options?: {
  modelKey?: string;
  environment?: NodeJS.ProcessEnv;
}): BrandProfileGenerator {
  const environment = options?.environment ?? process.env;
  if (options?.modelKey) throw new BrandProfileGenerationError("MODEL_CONFIGURATION_UNAVAILABLE", false);
  return new ValidatedBrandProfileGenerator(new AdmittedOnboardingStructuredGenerationClient(environment));
}
