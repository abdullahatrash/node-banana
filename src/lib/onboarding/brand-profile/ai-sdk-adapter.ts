import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import {
  generateText,
  NoObjectGeneratedError,
  Output,
  type LanguageModel,
} from "ai";
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

type OnboardingModelProvider = "google" | "openai" | "anthropic";

interface OnboardingModelConfig {
  provider: OnboardingModelProvider;
  modelId: string;
  envKey: "GEMINI_API_KEY" | "OPENAI_API_KEY" | "ANTHROPIC_API_KEY";
}

const MODEL_REGISTRY: Record<string, OnboardingModelConfig> = {
  "gemini-2.5-flash": {
    provider: "google",
    modelId: "gemini-2.5-flash",
    envKey: "GEMINI_API_KEY",
  },
  "gemini-3-flash-preview": {
    provider: "google",
    modelId: "gemini-3-flash-preview",
    envKey: "GEMINI_API_KEY",
  },
  "gpt-4.1-mini": {
    provider: "openai",
    modelId: "gpt-4.1-mini",
    envKey: "OPENAI_API_KEY",
  },
  "gpt-4.1-nano": {
    provider: "openai",
    modelId: "gpt-4.1-nano",
    envKey: "OPENAI_API_KEY",
  },
  "claude-sonnet-4.5": {
    provider: "anthropic",
    modelId: "claude-sonnet-4-5-20250929",
    envKey: "ANTHROPIC_API_KEY",
  },
};

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`);
}

export class AiSdkStructuredGenerationClient implements StructuredGenerationClient {
  constructor(private readonly model: LanguageModel) {}

  async generate(request: StructuredGenerationRequest): Promise<unknown> {
    try {
      const result = await generateText({
        model: this.model,
        system: request.system,
        prompt: request.prompt,
        output: Output.object({
          schema: request.schema,
          name: request.schemaName,
          description: request.schemaDescription,
        }),
        temperature: 0.1,
        maxOutputTokens: 8_192,
        maxRetries: 2,
      });
      return result.output;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        throw new InvalidStructuredOutputError([
          error.finishReason === "length"
            ? "root: output was truncated"
            : "root: output did not match the required schema",
        ]);
      }
      throw error;
    }
  }
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
      output = await input.client.generate({ ...input.request, prompt });
    } catch (error) {
      if (error instanceof InvalidStructuredOutputError) {
        issues = error.issues;
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

    return generateWithOneRepair({
      client: this.client,
      request: {
        kind: "activation_artifact",
        schema: activationArtifactV1Schema,
        schemaName: "ActivationArtifactV1",
        schemaDescription: "One editable, immediately useful content suggestion.",
        system: ACTIVATION_SYSTEM_PROMPT,
        prompt,
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

function createLanguageModel(modelKey: string, environment: NodeJS.ProcessEnv): LanguageModel {
  const config = MODEL_REGISTRY[modelKey];
  const apiKey = config ? environment[config.envKey] : undefined;
  if (!config || !apiKey) {
    throw new BrandProfileGenerationError("MODEL_CONFIGURATION_UNAVAILABLE", false);
  }

  switch (config.provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey })(config.modelId);
    case "openai":
      return createOpenAI({ apiKey })(config.modelId);
    case "anthropic":
      return createAnthropic({ apiKey })(config.modelId);
  }
}

export function createConfiguredBrandProfileGenerator(options?: {
  modelKey?: string;
  environment?: NodeJS.ProcessEnv;
}): BrandProfileGenerator {
  const environment = options?.environment ?? process.env;
  const modelKey = options?.modelKey ?? environment.ONBOARDING_LLM_MODEL ?? "gemini-2.5-flash";
  const model = createLanguageModel(modelKey, environment);
  return new ValidatedBrandProfileGenerator(new AiSdkStructuredGenerationClient(model));
}
