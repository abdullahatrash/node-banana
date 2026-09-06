import { z } from "zod";
import { ARABIC_VARIETIES, CONTENT_FORMATS } from "./definitions";

const text = (max: number) => z.string().trim().min(1).max(max);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const httpsUrl = z.string().url().refine((value) => value.startsWith("https://"), "HTTPS is required");

export const licensedTrendCatalogUnsignedSchema = z.object({
  schema: z.literal("licensed-trend-catalog-entry/v1"),
  id: text(200),
  revision: z.number().int().positive(),
  provider: z.object({
    key: z.string().regex(/^[a-z][a-z0-9._-]{1,119}$/),
    itemId: text(200),
    sourceUrl: httpsUrl,
    attribution: text(300),
  }).strict(),
  title: text(240),
  sourceName: text(200),
  publishedAt: z.string().datetime(),
  metrics: z.object({
    views: z.number().int().nonnegative().nullable(),
    likes: z.number().int().nonnegative().nullable(),
    comments: z.number().int().nonnegative().nullable(),
    observedAt: z.string().datetime(),
  }).strict(),
  media: z.object({
    type: z.enum(["image", "video"]),
    mimeType: text(120),
    sizeBytes: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    durationSeconds: z.number().int().positive().nullable(),
    storageKey: text(1_000),
    versionId: text(500).nullable(),
    etag: text(500),
    digest,
  }).strict(),
  evidenceDocument: z.object({
    mimeType: text(120),
    sizeBytes: z.number().int().positive(),
    storageKey: text(1_000),
    versionId: text(500).nullable(),
    etag: text(500),
    digest,
  }).strict(),
  rights: z.object({
    basis: z.literal("licensed"),
    permittedRemix: z.enum(["transform", "derivative"]),
    issuer: z.object({ type: z.enum(["license_authority", "rights_holder"]), id: text(200) }).strict(),
    scope: z.object({
      commercialUse: z.literal(true),
      derivativeUse: z.boolean(),
      modelInputUse: z.literal(true),
      territories: z.array(text(80)).min(1).max(100),
    }).strict(),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
  }).strict(),
  classification: z.object({
    region: text(80),
    contentLanguage: z.enum(["ar", "en"]),
    arabicVariety: z.enum(ARABIC_VARIETIES).nullable(),
    format: z.enum(CONTENT_FORMATS),
    tags: z.array(text(80)).max(30),
    creativePrimitives: z.object({
      topics: z.array(text(120)).max(12),
      hookPattern: text(500).nullable(),
      pacing: text(500).nullable(),
      structure: z.array(text(500)).max(12),
    }).strict(),
  }).strict(),
}).strict();

export const licensedTrendCatalogDocumentSchema = licensedTrendCatalogUnsignedSchema.extend({ digest }).strict().superRefine((value, context) => {
  const publishedAt = new Date(value.publishedAt);
  const observedAt = new Date(value.metrics.observedAt);
  const issuedAt = new Date(value.rights.issuedAt);
  const expiresAt = value.rights.expiresAt ? new Date(value.rights.expiresAt) : null;
  if (publishedAt > observedAt) context.addIssue({ code: "custom", path: ["metrics", "observedAt"], message: "Metrics cannot predate publication" });
  if (value.metrics.views === null && value.metrics.likes === null && value.metrics.comments === null) context.addIssue({ code: "custom", path: ["metrics"], message: "At least one metric is required" });
  if (expiresAt && expiresAt <= issuedAt) context.addIssue({ code: "custom", path: ["rights", "expiresAt"], message: "Expiry must follow issuance" });
  if (value.rights.permittedRemix === "derivative" && !value.rights.scope.derivativeUse) context.addIssue({ code: "custom", path: ["rights", "scope", "derivativeUse"], message: "Derivative use must be granted" });
  if (value.classification.contentLanguage !== "ar" && value.classification.arabicVariety !== null) context.addIssue({ code: "custom", path: ["classification", "arabicVariety"], message: "Arabic variety only applies to Arabic content" });
});

export const licensedTrendEntitlementDocumentSchema = z.object({
  schema: z.literal("licensed-trend-workspace-entitlement/v1"),
  id: text(200),
  workspaceId: text(200),
  catalog: z.object({ id: text(200), revision: z.number().int().positive(), digest }).strict(),
  state: z.enum(["active", "revoked"]),
  territories: z.array(text(80)).min(1).max(100),
  grantedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  grantAuthority: text(200),
  digest,
}).strict();

export type LicensedTrendCatalogDocument = z.infer<typeof licensedTrendCatalogDocumentSchema>;
export type LicensedTrendEntitlementDocument = z.infer<typeof licensedTrendEntitlementDocumentSchema>;

export type LicensedTrendCatalogCard = {
  catalogId: string;
  revision: number;
  entitlementId: string;
  state: "available" | "importing" | "imported" | "failed";
  importJobId: string | null;
  inspirationItemId: string | null;
  previewUrl: string;
  document: LicensedTrendCatalogDocument;
};
