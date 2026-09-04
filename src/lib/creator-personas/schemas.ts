import { z } from "zod";
import { ARABIC_VARIETIES } from "@/lib/product-surfaces/definitions";

const id = z.string().trim().min(1).max(200);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/).transform((value) => value as `sha256:${string}`);
const date = z.string().datetime();

export const createPersonaSchema = z.object({
  action: z.literal("create"),
  name: z.string().trim().min(1).max(160),
  kind: z.enum(["synthetic", "consented_likeness"]),
  contentLanguage: z.enum(["ar", "en"]),
  arabicVariety: z.enum(ARABIC_VARIETIES).nullable(),
  disclosure: z.string().trim().min(10).max(2_000),
  retentionUntil: date,
  idempotencyKey: id,
}).superRefine((value, context) => {
  if (value.contentLanguage === "ar" && !value.arabicVariety) context.addIssue({ code: "custom", path: ["arabicVariety"], message: "ARABIC_VARIETY_REQUIRED" });
});

const consentScope = z.object({
  kind: z.literal("likeness_consent"),
  subjectReference: id,
  sourceAssetIds: z.array(id).min(1).max(100),
  allowedPurposes: z.array(z.enum(["training", "generation", "content_set", "channel", "blitz"])).min(1),
  geographies: z.array(z.string().trim().min(2).max(32)).min(1),
  revocable: z.literal(true),
});
const acceptanceScope = z.object({
  kind: z.literal("provider_acceptance"),
  provider: id,
  model: id,
  modelVersion: id,
  inputSchemaDigest: digest,
  policyVersion: id,
  qualificationDigest: digest,
  acceptedUses: z.array(z.enum(["training", "generation", "content_set", "channel", "blitz"])).min(1),
});
const disclosureScope = z.object({
  kind: z.literal("disclosure_review"),
  locales: z.array(z.enum(["ar", "en"])).min(1),
  channels: z.array(z.string().trim().min(1).max(80)).min(1),
  templateDigest: digest,
});
const abuseScope = z.object({
  kind: z.literal("abuse_review"),
  policyVersion: id,
  riskLevel: z.enum(["low", "standard", "elevated"]),
  prohibitedUsesAcknowledged: z.literal(true),
});

export const addPersonaEvidenceSchema = z.object({
  action: z.literal("add_evidence"),
  expectedRevision: z.number().int().positive(),
  issuer: z.enum(["workspace_consent_officer", "provider_policy_registry", "trust_review_service"]),
  subjectDigest: digest,
  evidenceDigest: digest,
  scope: z.discriminatedUnion("kind", [consentScope, acceptanceScope, disclosureScope, abuseScope]),
  effectiveAt: date,
  expiresAt: date,
  issuerSignature: z.string().regex(/^hmac-sha256:[a-f0-9]{64}$/).nullable().default(null),
  idempotencyKey: id,
}).superRefine((value, context) => {
  const issuerFor = { likeness_consent: "workspace_consent_officer", provider_acceptance: "provider_policy_registry", disclosure_review: "trust_review_service", abuse_review: "trust_review_service" } as const;
  if (issuerFor[value.scope.kind] !== value.issuer) context.addIssue({ code: "custom", path: ["issuer"], message: "EVIDENCE_ISSUER_MISMATCH" });
  if (new Date(value.expiresAt) <= new Date(value.effectiveAt)) context.addIssue({ code: "custom", path: ["expiresAt"], message: "EVIDENCE_WINDOW_INVALID" });
});

export const attachPersonaSourcesSchema = z.object({
  action: z.literal("attach_sources"),
  expectedRevision: z.number().int().positive(),
  assetIds: z.array(id).min(1).max(100),
  consentEvidenceId: id.nullable(),
  idempotencyKey: id,
});

export const requestPersonaTrainingSchema = z.object({
  action: z.literal("request_training"),
  expectedRevision: z.number().int().positive(),
  provider: z.literal("replicate"),
  model: id,
  modelVersion: id,
  qualificationDigest: digest,
  idempotencyKey: id,
});

export const resolvePersonaTrainingSchema = z.object({
  action: z.literal("resolve_training"),
  expectedRevision: z.number().int().positive(),
  trainingJobId: id,
  outcome: z.enum(["succeeded", "failed_known", "outcome_unknown", "cancelled"]),
  resultModelRef: z.object({
    schema: z.literal("creator-persona-model/v1"),
    provider: z.literal("replicate"),
    model: id,
    version: id,
    inputSchemaDigest: digest,
    qualificationDigest: digest,
    trainingJobId: id,
  }).strict().nullable(),
  failureCode: z.string().trim().min(3).max(100).nullable(),
  idempotencyKey: id,
}).superRefine((value, context) => {
  if (value.outcome === "succeeded" && !value.resultModelRef) context.addIssue({ code: "custom", path: ["resultModelRef"], message: "MODEL_REF_REQUIRED" });
  if (value.outcome === "failed_known" && !value.failureCode) context.addIssue({ code: "custom", path: ["failureCode"], message: "FAILURE_CODE_REQUIRED" });
});

export const activatePersonaSchema = z.object({ action: z.literal("activate"), expectedRevision: z.number().int().positive(), idempotencyKey: id });
export const suspendPersonaSchema = z.object({ action: z.literal("suspend"), expectedRevision: z.number().int().positive(), reasonCode: z.string().regex(/^[a-z][a-z0-9_.-]{2,99}$/), idempotencyKey: id });
export const deletePersonaSchema = z.object({ action: z.literal("delete"), expectedRevision: z.number().int().positive(), idempotencyKey: id });
export const bindPersonaUsageSchema = z.object({
  action: z.literal("bind_usage"), expectedRevision: z.number().int().positive(),
  purpose: z.enum(["generation", "content_set", "channel", "blitz"]), resourceId: id, idempotencyKey: id,
});

export const personaCommandSchema = z.discriminatedUnion("action", [
  addPersonaEvidenceSchema, attachPersonaSourcesSchema, requestPersonaTrainingSchema,
  activatePersonaSchema, suspendPersonaSchema,
  deletePersonaSchema, bindPersonaUsageSchema,
]);
