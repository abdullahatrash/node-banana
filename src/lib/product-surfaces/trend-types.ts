import { z } from "zod";
import { ARABIC_VARIETIES, CONTENT_FORMATS } from "./definitions";

export const TREND_SOURCE_KINDS = ["official_api", "licensed_dataset", "public_metadata", "embeddable_feed", "workspace_owned_analytics"] as const;
export const TREND_RIGHTS_STATUSES = ["licensed", "user_submitted", "embeddable", "metadata_only", "restricted"] as const;
export const TREND_INFLUENCE_TYPES = ["topic", "hook", "pacing", "structure"] as const;

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const id = z.string().trim().min(1).max(200);

export const trendIngestionCandidateSchema = z.object({
  externalItemId: id,
  title: z.string().trim().min(1).max(240),
  sourceUrl: z.string().url().max(2_048).refine((value) => new URL(value).protocol === "https:", "Trend source URLs must use HTTPS."),
  sourceName: z.string().trim().min(1).max(200),
  sourcePublishedAt: z.string().datetime(),
  sourceContentDigest: digest,
  metricsObservedAt: z.string().datetime(),
  metrics: z.object({ views: z.number().int().nonnegative().nullable(), likes: z.number().int().nonnegative().nullable(), comments: z.number().int().nonnegative().nullable().optional() }).strict().refine((metrics) => Object.values(metrics).some((value) => value !== null), "At least one provider metric is required."),
  observationProvenance: z.object({
    kind: z.enum(["workspace_attested", "platform_verified"]),
    ref: z.string().trim().min(1).max(500),
    digest,
  }).strict().nullable().optional(),
  region: z.string().trim().max(80),
  contentLanguage: z.enum(["ar", "en"]),
  arabicVariety: z.enum(ARABIC_VARIETIES).nullable(),
  format: z.enum(CONTENT_FORMATS),
  tags: z.array(z.string().trim().min(1).max(80)).max(30),
  creativePrimitives: z.object({
    topics: z.array(z.string().trim().min(1).max(120)).max(12),
    hookPattern: z.string().trim().min(1).max(500).nullable(),
    pacing: z.string().trim().min(1).max(500).nullable(),
    structure: z.array(z.string().trim().min(1).max(500)).max(12),
  }).strict().default({ topics: [], hookPattern: null, pacing: null, structure: [] }),
  rights: z.object({
    status: z.enum(TREND_RIGHTS_STATUSES),
    evidenceRef: z.string().trim().min(1).max(500),
    evidenceDigest: digest,
    observedAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
    sourceAssetId: id.nullable(),
    sourceMediaType: z.enum(["image", "video"]).nullable(),
    rightsSnapshot: z.object({ id, revision: z.number().int().positive(), digest }).strict().nullable(),
    permittedInfluence: z.array(z.enum(TREND_INFLUENCE_TYPES)).min(1).max(4),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (new Date(value.metricsObservedAt) < new Date(value.sourcePublishedAt)) context.addIssue({ code: "custom", path: ["metricsObservedAt"], message: "Metrics cannot predate the source." });
  if (new Date(value.rights.observedAt) > new Date(value.metricsObservedAt)) context.addIssue({ code: "custom", path: ["rights", "observedAt"], message: "Rights evidence must exist when the metric observation is captured." });
  if (value.rights.expiresAt && new Date(value.rights.expiresAt) <= new Date(value.rights.observedAt)) context.addIssue({ code: "custom", path: ["rights", "expiresAt"], message: "Rights expiry must follow its observation." });
  if (value.rights.status === "metadata_only" && value.rights.permittedInfluence.some((item) => item !== "topic")) context.addIssue({ code: "custom", path: ["rights", "permittedInfluence"], message: "Metadata-only evidence may influence topics only." });
  const referenceParts = [value.rights.sourceAssetId, value.rights.sourceMediaType, value.rights.rightsSnapshot];
  if (referenceParts.some((part) => part === null) && referenceParts.some((part) => part !== null)) context.addIssue({ code: "custom", path: ["rights"], message: "A source Asset, media type, and Rights Snapshot must be supplied together." });
});

export type TrendIngestionCandidate = z.infer<typeof trendIngestionCandidateSchema>;
export type TrendSourceKind = (typeof TREND_SOURCE_KINDS)[number];
export type TrendRightsStatus = (typeof TREND_RIGHTS_STATUSES)[number];

export const trendRankingContextSchema = z.object({
  brandProfile: z.object({ id, revision: z.number().int().positive(), digest, contentLanguage: z.enum(["ar", "en"]), keywords: z.array(z.string().max(500)).max(200) }).strict().nullable(),
  preferredRegions: z.array(z.string().max(80)).max(20),
  preferredArabicVarieties: z.array(z.enum(ARABIC_VARIETIES)).max(5),
  preferredFormats: z.array(z.enum(CONTENT_FORMATS)).max(CONTENT_FORMATS.length),
  preferredTags: z.array(z.string().max(80)).max(50),
  excludedTags: z.array(z.string().max(80)).max(50),
}).strict();

export type TrendRankingContext = z.infer<typeof trendRankingContextSchema>;

export interface TrendRankingEvidence {
  schema: "inspiration-trend-ranking/v1";
  score: number;
  signals: {
    freshness: number; recency: number; performance: number; brandFit: number; region: number;
    language: number; arabicVariety: number; format: number; rights: number; preference: number;
  };
  reasonCodes: string[];
  brandProfile: { id: string; revision: number; digest: `sha256:${string}` } | null;
  eligibleForDiscovery: boolean;
  eligibleForBlitz: boolean;
  evaluatedAt: string;
  digest: `sha256:${string}`;
}

export interface TrendIngestionAdapter {
  readonly key: string;
  fetch(input: { workspaceId: string; sourceId: string; cursor: string | null; limit: number; requestedAt: Date }): Promise<{ items: unknown[]; nextCursor: string | null; hasMore: boolean }>;
}
