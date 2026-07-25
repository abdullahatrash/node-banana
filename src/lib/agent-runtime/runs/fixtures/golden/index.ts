import frozenWorkflow from "../../../workflows/__fixtures__/linkedin-golden-workflow-v1.json";
import type { WorkflowDraft } from "../../../workflows/types";

export const GOLDEN_FIXTURE_SCHEMA =
  "linkedin-golden-workflow-execution-fixture/v1" as const;

export const GOLDEN_WORKFLOW_FIXTURE_PATH =
  "src/lib/agent-runtime/workflows/__fixtures__/linkedin-golden-workflow-v1.json";
export const GOLDEN_WORKFLOW_FIXTURE_SIZE_BYTES = 2_160;
export const GOLDEN_WORKFLOW_FIXTURE_BYTE_DIGEST =
  "sha256:24869dcde2742dbf0492b411e4a77753888f16763c093a753364da75c8ee5b76";
export const GOLDEN_WORKFLOW_ID = "fixture-workflow";
export const GOLDEN_WORKFLOW_DEFINITION_DIGEST =
  "sha256:b5c5f58a1413295e7678bce0ce80b5fc2f93335bf5b2f449e5a01f08724b5bc3";
export const GOLDEN_OPERATION_REGISTRY_DIGEST =
  "sha256:a201e3e3177c312319f89acd5dfd334729f87d6fa8e02f6937fe6924b68a2a77";

function immutable<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * This is an immutable wrapper around the #155 fixture, not an alternative
 * execution draft. Provider conformance is supplied by the runtime adapter.
 */
export const GOLDEN_WORKFLOW_DRAFT = immutable(
  structuredClone(frozenWorkflow),
) as WorkflowDraft;

export const GOLDEN_BRIEF =
  "Product: Banana Flow\n" +
  "Audience: B2B marketing teams\n" +
  "Promise: Turn one approved brief and a reference image into traceable LinkedIn copy and a square hero image.\n" +
  "Tone: Clear, confident, practical.\n" +
  "CTA: Build once. Publish with confidence.\n";

export const GOLDEN_LINKEDIN_COPY =
  "Meet Banana Flow: turn one approved brief and a reference image into campaign-ready content in one repeatable workflow.\n\n" +
  "Draft polished LinkedIn copy, generate an on-brand hero image, and keep every input, effect, and output traceable from a single run.\n\n" +
  "Build once. Publish with confidence.\n\n" +
  "#MarketingOps #GenerativeAI #ContentWorkflow\n";

export const GOLDEN_TEXT_BYTES = {
  brief: {
    sizeBytes: 237,
    digest:
      "sha256:fdd0c6470a05ee342718614bc6eb3756b7a0dd496019cd76d98420ee7ac570e1",
    mediaType: "text/plain; charset=utf-8",
  },
  linkedInCopy: {
    sizeBytes: 338,
    digest:
      "sha256:3bb04cf473ba895f5ff4073330ac6de34ea19fec09d67b4326424ecce1a5f94c",
    mediaType: "text/plain; charset=utf-8",
  },
} as const;

/** Repository-root-relative paths; consumers read bytes, never public URLs. */
export const GOLDEN_IMAGE_FIXTURES = {
  reference: {
    path: "public/sample-images/style-transfer-reference.png",
    mediaType: "image/png",
    sizeBytes: 1_928_777,
    digest:
      "sha256:37fb2f3c28de768b5a0847b447b802deb5f26311df9abfde3b3a3f1c84fd06b6",
    width: 1024,
    height: 1024,
  },
  heroResult: {
    path: "public/banana_icon.png",
    mediaType: "image/png",
    sizeBytes: 19_885,
    digest:
      "sha256:a507544ddb53fb1490ac986852553990360ac08fdae69e042b30c53a6a655c5e",
    width: 512,
    height: 512,
  },
} as const;

export const GOLDEN_OPERATION_CONTRACTS = {
  draftCopy: {
    identity: "gemini.generate_text@1",
    contractDigest:
      "sha256:fb494fb8de2cf72b3d8b97b8cc7bd9fb3e87f7c8dfee72e1861c262339a41dc7",
    provider: "conformance",
    providerOperation: "generate_text",
    model: "golden-v1",
  },
  generateHero: {
    identity: "gemini.generate_image@1",
    contractDigest:
      "sha256:2e4b7d03dc18b5b94138a634997cc03ab317ec2ff0a2013088bdf0f13843eaa0",
    provider: "conformance",
    providerOperation: "generate_image",
    model: "golden-v1",
  },
} as const;

export const GOLDEN_PROVIDER_INTENTS = {
  draftCopy: {
    schema: "golden-provider-intent/v1",
    operationIdentity: GOLDEN_OPERATION_CONTRACTS.draftCopy.identity,
    provider: GOLDEN_OPERATION_CONTRACTS.draftCopy.provider,
    providerOperation:
      GOLDEN_OPERATION_CONTRACTS.draftCopy.providerOperation,
    model: GOLDEN_OPERATION_CONTRACTS.draftCopy.model,
    prompt: GOLDEN_BRIEF,
  },
  generateHero: {
    schema: "golden-provider-intent/v1",
    operationIdentity: GOLDEN_OPERATION_CONTRACTS.generateHero.identity,
    provider: GOLDEN_OPERATION_CONTRACTS.generateHero.provider,
    providerOperation:
      GOLDEN_OPERATION_CONTRACTS.generateHero.providerOperation,
    model: GOLDEN_OPERATION_CONTRACTS.generateHero.model,
    prompt: GOLDEN_LINKEDIN_COPY,
    referenceImage: {
      mediaType: GOLDEN_IMAGE_FIXTURES.reference.mediaType,
      digest: GOLDEN_IMAGE_FIXTURES.reference.digest,
      sizeBytes: GOLDEN_IMAGE_FIXTURES.reference.sizeBytes,
      width: GOLDEN_IMAGE_FIXTURES.reference.width,
      height: GOLDEN_IMAGE_FIXTURES.reference.height,
    },
  },
} as const;

export const GOLDEN_PROVIDER_RESULTS = {
  draftCopy: {
    schema: "golden-provider-result/v1",
    operationIdentity: GOLDEN_OPERATION_CONTRACTS.draftCopy.identity,
    provider: GOLDEN_OPERATION_CONTRACTS.draftCopy.provider,
    providerOperation:
      GOLDEN_OPERATION_CONTRACTS.draftCopy.providerOperation,
    providerOperationRef: "conformance:golden:draft_copy:v1",
    output: {
      kind: "text",
      text: GOLDEN_LINKEDIN_COPY,
      ...GOLDEN_TEXT_BYTES.linkedInCopy,
    },
  },
  generateHero: {
    schema: "golden-provider-result/v1",
    operationIdentity: GOLDEN_OPERATION_CONTRACTS.generateHero.identity,
    provider: GOLDEN_OPERATION_CONTRACTS.generateHero.provider,
    providerOperation:
      GOLDEN_OPERATION_CONTRACTS.generateHero.providerOperation,
    providerOperationRef: "conformance:golden:generate_hero:v1",
    output: {
      kind: "image",
      ...GOLDEN_IMAGE_FIXTURES.heroResult,
    },
  },
} as const;

export const GOLDEN_EXPECTED_OUTPUT = {
  schema: GOLDEN_FIXTURE_SCHEMA,
  workflow: {
    workflowId: GOLDEN_WORKFLOW_ID,
    definitionDigest: GOLDEN_WORKFLOW_DEFINITION_DIGEST,
    operationRegistryDigest: GOLDEN_OPERATION_REGISTRY_DIGEST,
  },
  inputs: {
    brief: {
      kind: "text",
      value: GOLDEN_BRIEF,
      ...GOLDEN_TEXT_BYTES.brief,
    },
    reference_image: {
      kind: "image",
      ...GOLDEN_IMAGE_FIXTURES.reference,
    },
  },
  outputs: {
    post_copy: GOLDEN_PROVIDER_RESULTS.draftCopy.output,
    hero_image: GOLDEN_PROVIDER_RESULTS.generateHero.output,
  },
} as const;
