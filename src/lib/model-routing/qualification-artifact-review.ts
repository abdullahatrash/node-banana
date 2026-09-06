import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import sharp from "sharp";

import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { getDb } from "@/lib/db";
import { modelQualificationArtifactInspections, modelQualificationArtifactReviews, modelQualificationCases, type QualificationInspectedMediaItem } from "./db-schema";
import type { QualificationIngestionReceipt, QualificationSmokeCase } from "./qualification-runner";

type Db = ReturnType<typeof getDb>;
type Capability = QualificationSmokeCase["capability"];
type Language = "ar" | "en";
const MAX_BYTES = 500 * 1024 * 1024;
const MAX_OUTPUTS = 8;

export type QualificationArtifactInspection = {
  receiptId: string;
  predictionId: string;
  caseId: string;
  capability: Capability;
  contentLanguage: Language;
  kind: "text" | "media";
  contentDigest: `sha256:${string}`;
  items: QualificationInspectedMediaItem[] | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  fps: number | null;
  characterCount: number | null;
  outputLocatorDigest: `sha256:${string}`;
  technicalEvidenceDigest: `sha256:${string}`;
};

function sha256(bytes: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function detectQualificationTextLanguages(value: string): Language[] {
  const languages: Language[] = [];
  if (/\p{Script=Arabic}/u.test(value)) languages.push("ar");
  if (/[A-Za-z]/.test(value)) languages.push("en");
  return languages;
}

function textOutput(output: unknown): string {
  if (typeof output === "string" && output.trim()) return output;
  if (Array.isArray(output) && output.length > 0 && output.every((item) => typeof item === "string")) {
    const joined = output.join("\n");
    if (joined.trim()) return joined;
  }
  throw new Error("QUALIFICATION_TEXT_OUTPUT_UNSUPPORTED");
}

function collectHttpsUrls(value: unknown, depth = 0, found: string[] = []): string[] {
  if (found.length >= MAX_OUTPUTS || depth > 4) return found;
  if (typeof value === "string") {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && !found.includes(url.toString())) found.push(url.toString());
    } catch { /* not a URL */ }
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHttpsUrls(item, depth + 1, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectHttpsUrls(item, depth + 1, found);
  }
  return found;
}

export function isAllowedQualificationArtifactUrl(value: string | URL, allowedHosts: readonly string[]) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    return url.protocol === "https:" && allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

async function download(fetcher: typeof fetch, url: URL, path: string, allowedHosts: readonly string[]) {
  const response = await fetcher(url, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body || !isAllowedQualificationArtifactUrl(response.url || url, allowedHosts)) throw new Error("QUALIFICATION_OUTPUT_FETCH_FAILED");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_BYTES) throw new Error("QUALIFICATION_OUTPUT_SIZE_INVALID");
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const handle = await open(path, "wx");
  const hash = createHash("sha256");
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES || (declared > 0 && size > declared)) throw new Error("QUALIFICATION_OUTPUT_SIZE_INVALID");
      hash.update(value);
      await handle.write(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    await handle.close();
  }
  if (size <= 0 || (declared > 0 && size !== declared)) throw new Error("QUALIFICATION_OUTPUT_SIZE_INVALID");
  return { contentType, contentDigest: `sha256:${hash.digest("hex")}` as `sha256:${string}` };
}

async function probeMedia(path: string, kind: "image" | "video"): Promise<Omit<QualificationInspectedMediaItem, "contentDigest">> {
  if (kind === "image") {
    const metadata = await sharp(path, { failOn: "error", limitInputPixels: 100_000_000 }).metadata();
    if (!metadata.width || !metadata.height) throw new Error("QUALIFICATION_IMAGE_METADATA_REQUIRED");
    return { width: metadata.width, height: metadata.height, durationSeconds: null, fps: null };
  }
  const { ALL_FORMATS, FilePathSource, Input } = await import("mediabunny");
  const media = new Input({ formats: ALL_FORMATS, source: new FilePathSource(path) });
  try {
    const track = await media.getPrimaryVideoTrack();
    if (!track) throw new Error("QUALIFICATION_VIDEO_TRACK_REQUIRED");
    const [durationSeconds, stats] = await Promise.all([media.computeDuration(), track.computePacketStats(240)]);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("QUALIFICATION_VIDEO_DURATION_INVALID");
    if (!Number.isFinite(stats.averagePacketRate) || stats.averagePacketRate <= 0) throw new Error("QUALIFICATION_VIDEO_FPS_INVALID");
    return { width: track.displayWidth, height: track.displayHeight, durationSeconds, fps: stats.averagePacketRate };
  } finally {
    media.dispose();
  }
}

export async function inspectQualificationArtifact(input: {
  predictionId: string;
  caseId: string;
  capability: Capability;
  contentLanguage: Language;
  output: unknown;
  fetcher?: typeof fetch;
  allowedHosts?: readonly string[];
}): Promise<{ inspection: QualificationArtifactInspection; automaticallyObservedLanguages: Language[] | null }> {
  const base = { schema: "replicate-qualification-artifact-inspection/v1", predictionId: input.predictionId, caseId: input.caseId, capability: input.capability, contentLanguage: input.contentLanguage };
  if (input.capability === "text_generation") {
    const content = textOutput(input.output);
    const contentDigest = sha256(content);
    const characterCount = Array.from(content).length;
    const outputLocatorDigest = canonicalDigest({ kind: "inline_text", contentDigest }) as `sha256:${string}`;
    const technical = { ...base, kind: "text" as const, contentDigest, characterCount, outputLocatorDigest };
    const technicalEvidenceDigest = canonicalDigest(technical) as `sha256:${string}`;
    return {
      inspection: { receiptId: `qai_${technicalEvidenceDigest.slice(-32)}`, predictionId: input.predictionId, caseId: input.caseId, capability: input.capability, contentLanguage: input.contentLanguage, kind: "text", contentDigest, items: null, width: null, height: null, durationSeconds: null, fps: null, characterCount, outputLocatorDigest, technicalEvidenceDigest },
      automaticallyObservedLanguages: detectQualificationTextLanguages(content),
    };
  }

  const urls = collectHttpsUrls(input.output);
  if (urls.length === 0) throw new Error("QUALIFICATION_MEDIA_OUTPUT_UNSUPPORTED");
  const allowedHosts = input.allowedHosts ?? (process.env.REPLICATE_OUTPUT_HOSTS ?? "replicate.delivery").split(",").map((item) => item.trim()).filter(Boolean);
  if (allowedHosts.length === 0 || urls.some((url) => !isAllowedQualificationArtifactUrl(url, allowedHosts))) throw new Error("QUALIFICATION_OUTPUT_HOST_NOT_ALLOWED");
  const mediaKind = input.capability === "text_to_image" || input.capability === "image_to_image" ? "image" : "video";
  const directory = await mkdtemp(join(tmpdir(), "node-banana-qualification-"));
  try {
    const items: QualificationInspectedMediaItem[] = [];
    for (const [index, value] of urls.entries()) {
      const path = join(directory, `output-${index}`);
      const downloaded = await download(input.fetcher ?? fetch, new URL(value), path, allowedHosts);
      if ((mediaKind === "image" && !downloaded.contentType.startsWith("image/")) || (mediaKind === "video" && !downloaded.contentType.startsWith("video/"))) throw new Error("QUALIFICATION_OUTPUT_MEDIA_TYPE_MISMATCH");
      items.push({ contentDigest: downloaded.contentDigest, ...await probeMedia(path, mediaKind) });
    }
    const contentDigest = canonicalDigest(items) as `sha256:${string}`;
    const outputLocatorDigest = canonicalDigest(urls) as `sha256:${string}`;
    const first = items[0]!;
    const technical = { ...base, kind: "media" as const, contentDigest, items, outputLocatorDigest };
    const technicalEvidenceDigest = canonicalDigest(technical) as `sha256:${string}`;
    return {
      inspection: { receiptId: `qai_${technicalEvidenceDigest.slice(-32)}`, predictionId: input.predictionId, caseId: input.caseId, capability: input.capability, contentLanguage: input.contentLanguage, kind: "media", contentDigest, items, width: first.width, height: first.height, durationSeconds: first.durationSeconds, fps: first.fps, characterCount: null, outputLocatorDigest, technicalEvidenceDigest },
      automaticallyObservedLanguages: null,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function sameInspection(row: typeof modelQualificationArtifactInspections.$inferSelect, value: QualificationArtifactInspection) {
  return row.receiptId === value.receiptId && row.predictionId === value.predictionId && row.caseId === value.caseId && row.capability === value.capability && row.contentLanguage === value.contentLanguage && row.kind === value.kind && row.contentDigest === value.contentDigest && row.outputLocatorDigest === value.outputLocatorDigest && row.technicalEvidenceDigest === value.technicalEvidenceDigest;
}

export async function recordQualificationArtifactInspection(input: { database: Db; inspection: QualificationArtifactInspection; at: Date }) {
  return input.database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`qualification-artifact:${input.inspection.predictionId}`}, 0))`);
    const [qualificationCase] = await tx.select().from(modelQualificationCases).where(and(eq(modelQualificationCases.caseId, input.inspection.caseId), eq(modelQualificationCases.predictionId, input.inspection.predictionId))).limit(1);
    if (!qualificationCase) throw new Error("QUALIFICATION_ARTIFACT_CASE_NOT_FOUND");
    const [existing] = await tx.select().from(modelQualificationArtifactInspections).where(eq(modelQualificationArtifactInspections.predictionId, input.inspection.predictionId)).limit(1);
    if (existing) {
      if (!sameInspection(existing, input.inspection)) throw new Error("QUALIFICATION_ARTIFACT_INSPECTION_CONFLICT");
      return { kind: "replayed" as const, inspection: input.inspection };
    }
    await tx.insert(modelQualificationArtifactInspections).values({
      ...input.inspection,
      runId: qualificationCase.runId,
      durationSeconds: input.inspection.durationSeconds === null ? null : input.inspection.durationSeconds.toFixed(3),
      fps: input.inspection.fps === null ? null : input.inspection.fps.toFixed(3),
      createdAt: input.at,
    });
    return { kind: "recorded" as const, inspection: input.inspection };
  });
}

export async function recordQualificationArtifactReview(input: {
  database: Db;
  receiptId: string;
  reviewedContentDigest: string;
  decision: "accepted" | "rejected";
  reviewerId: string;
  method: "automatic_unicode_script" | "operator_visual_review" | "operator_playback_review";
  observedLanguages: Language[];
  notes: string;
  at: Date;
}) {
  return input.database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`qualification-artifact-review:${input.receiptId}`}, 0))`);
    const [inspection] = await tx.select().from(modelQualificationArtifactInspections).where(eq(modelQualificationArtifactInspections.receiptId, input.receiptId)).limit(1);
    if (!/^sha256:[a-f0-9]{64}$/.test(input.reviewedContentDigest) || !inspection || inspection.contentDigest !== input.reviewedContentDigest) throw new Error("QUALIFICATION_ARTIFACT_REVIEW_BINDING_MISMATCH");
    const expectedMethod = inspection.kind === "text" ? "automatic_unicode_script" : inspection.capability === "text_to_image" || inspection.capability === "image_to_image" ? "operator_visual_review" : "operator_playback_review";
    if (input.method !== expectedMethod) throw new Error("QUALIFICATION_ARTIFACT_REVIEW_METHOD_MISMATCH");
    const observedLanguages = [...new Set(input.observedLanguages)].sort() as Language[];
    if (observedLanguages.length === 0 || observedLanguages.some((language) => language !== "ar" && language !== "en")) throw new Error("QUALIFICATION_ARTIFACT_REVIEW_LANGUAGE_INVALID");
    if (input.decision === "accepted" && !observedLanguages.includes(inspection.contentLanguage as Language)) throw new Error("QUALIFICATION_ARTIFACT_EXPECTED_LANGUAGE_MISSING");
    const notesDigest = canonicalDigest(input.notes.trim()) as `sha256:${string}`;
    const [existing] = await tx.select().from(modelQualificationArtifactReviews).where(eq(modelQualificationArtifactReviews.receiptId, input.receiptId)).limit(1);
    if (existing) {
      const sameLanguages = [...existing.observedLanguages].sort().join(",") === observedLanguages.join(",");
      if (existing.decision !== input.decision || existing.reviewerId !== input.reviewerId || existing.method !== input.method || !sameLanguages || existing.reviewedContentDigest !== input.reviewedContentDigest || existing.notesDigest !== notesDigest) throw new Error("QUALIFICATION_ARTIFACT_REVIEW_CONFLICT");
      return { kind: "replayed" as const, languageEvidenceDigest: existing.languageEvidenceDigest as `sha256:${string}` };
    }
    const review = { schema: "replicate-qualification-language-review/v1", receiptId: input.receiptId, decision: input.decision, reviewerId: input.reviewerId, method: input.method, observedLanguages, reviewedContentDigest: input.reviewedContentDigest, notesDigest, reviewedAt: input.at.toISOString() };
    const languageEvidenceDigest = canonicalDigest(review) as `sha256:${string}`;
    await tx.insert(modelQualificationArtifactReviews).values({ receiptId: input.receiptId, decision: input.decision, reviewerId: input.reviewerId, method: input.method, observedLanguages, reviewedContentDigest: input.reviewedContentDigest, languageEvidenceDigest, notesDigest, reviewedAt: input.at, createdAt: input.at });
    return { kind: "recorded" as const, languageEvidenceDigest };
  });
}

export async function readQualificationIngestionReceipt(input: { database: Db; predictionId: string; caseId: string; capability: Capability; contentLanguage: Language }): Promise<{ state: "pending"; receiptId: string; contentDigest: string; kind: string } | { state: "rejected"; receiptId: string } | { state: "accepted"; receipt: QualificationIngestionReceipt } | null> {
  const [row] = await input.database.select({ inspection: modelQualificationArtifactInspections, review: modelQualificationArtifactReviews }).from(modelQualificationArtifactInspections).leftJoin(modelQualificationArtifactReviews, eq(modelQualificationArtifactReviews.receiptId, modelQualificationArtifactInspections.receiptId)).where(and(eq(modelQualificationArtifactInspections.predictionId, input.predictionId), eq(modelQualificationArtifactInspections.caseId, input.caseId), eq(modelQualificationArtifactInspections.capability, input.capability), eq(modelQualificationArtifactInspections.contentLanguage, input.contentLanguage))).limit(1);
  if (!row) return null;
  if (!row.review) return { state: "pending", receiptId: row.inspection.receiptId, contentDigest: row.inspection.contentDigest, kind: row.inspection.kind };
  if (row.review.decision === "rejected") return { state: "rejected", receiptId: row.inspection.receiptId };
  const observedLanguages = row.review.observedLanguages as Language[];
  if (!observedLanguages.includes(input.contentLanguage)) return { state: "rejected", receiptId: row.inspection.receiptId };
  if (row.inspection.kind === "text") return { state: "accepted", receipt: { kind: "text", receiptId: row.inspection.receiptId, contentDigest: row.inspection.contentDigest as `sha256:${string}`, characterCount: row.inspection.characterCount!, observedLanguages, languageEvidenceDigest: row.review.languageEvidenceDigest as `sha256:${string}` } };
  const items = row.inspection.items ?? [];
  return { state: "accepted", receipt: { kind: "media", receiptId: row.inspection.receiptId, contentDigest: row.inspection.contentDigest as `sha256:${string}`, itemCount: items.length, items, width: row.inspection.width!, height: row.inspection.height!, durationSeconds: row.inspection.durationSeconds === null ? null : Number(row.inspection.durationSeconds), fps: row.inspection.fps === null ? null : Number(row.inspection.fps), observedLanguages, languageEvidenceDigest: row.review.languageEvidenceDigest as `sha256:${string}` } };
}

export async function listPendingQualificationArtifactInspections(input: { database: Db; limit: number }) {
  const rows = await input.database.select().from(modelQualificationArtifactInspections).leftJoin(modelQualificationArtifactReviews, eq(modelQualificationArtifactReviews.receiptId, modelQualificationArtifactInspections.receiptId)).where(isNull(modelQualificationArtifactReviews.receiptId)).orderBy(desc(modelQualificationArtifactInspections.createdAt)).limit(input.limit);
  return rows.map(({ model_qualification_artifact_inspections: inspection }) => ({
    receiptId: inspection.receiptId,
    predictionId: inspection.predictionId,
    predictionUrl: `https://replicate.com/p/${encodeURIComponent(inspection.predictionId)}`,
    caseId: inspection.caseId,
    capability: inspection.capability,
    expectedLanguage: inspection.contentLanguage,
    kind: inspection.kind,
    contentDigest: inspection.contentDigest,
    items: inspection.items,
    width: inspection.width,
    height: inspection.height,
    durationSeconds: inspection.durationSeconds === null ? null : Number(inspection.durationSeconds),
    fps: inspection.fps === null ? null : Number(inspection.fps),
    characterCount: inspection.characterCount,
    technicalEvidenceDigest: inspection.technicalEvidenceDigest,
    requiredMethod: inspection.kind === "text" ? "automatic_unicode_script" : inspection.capability === "text_to_image" || inspection.capability === "image_to_image" ? "operator_visual_review" : "operator_playback_review",
    createdAt: inspection.createdAt.toISOString(),
  }));
}
