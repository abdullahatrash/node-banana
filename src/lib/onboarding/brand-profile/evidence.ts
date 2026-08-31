import { createHash } from "node:crypto";
import type { BrandProfileV1 } from "../schemas";

export interface EvidenceSegment {
  sourceId: string;
  excerptHash: string;
  excerpt: string;
}

const MAX_SEGMENTS = 40;
const MAX_SEGMENT_CHARACTERS = 1_600;

function hashExcerpt(excerpt: string): string {
  return `sha256:${createHash("sha256").update(excerpt).digest("hex")}`;
}

function splitLongParagraph(paragraph: string): string[] {
  const segments: string[] = [];
  let remaining = paragraph;

  while (remaining.length > MAX_SEGMENT_CHARACTERS) {
    const boundary = remaining.lastIndexOf(" ", MAX_SEGMENT_CHARACTERS);
    const end = boundary >= MAX_SEGMENT_CHARACTERS / 2 ? boundary : MAX_SEGMENT_CHARACTERS;
    segments.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }

  if (remaining) segments.push(remaining);
  return segments;
}

export function buildEvidenceCatalog(sourceId: string, cleanedText: string): EvidenceSegment[] {
  const paragraphs = cleanedText
    .split(/\n{2,}/)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .flatMap(splitLongParagraph)
    .slice(0, MAX_SEGMENTS);

  return paragraphs.map((excerpt) => ({
    sourceId,
    excerptHash: hashExcerpt(excerpt),
    excerpt,
  }));
}

export function validateProfileEvidence(
  profile: BrandProfileV1,
  catalog: EvidenceSegment[],
): string[] {
  const issues: string[] = [];
  const allowedSources = new Set(catalog.map((item) => item.sourceId));
  const allowedReferences = new Set(
    catalog.map((item) => `${item.sourceId}:${item.excerptHash}`),
  );

  if (profile.evidence.length === 0) {
    issues.push("evidence: include at least one source-backed reference");
  }
  if (profile.uncertainties.length === 0) {
    issues.push("uncertainties: include at least one review note or uncertainty");
  }

  for (const sourceId of profile.sourceIds) {
    if (!allowedSources.has(sourceId)) {
      issues.push(`sourceIds: unknown source ${sourceId}`);
    }
  }

  for (const reference of profile.evidence) {
    const key = `${reference.sourceId}:${reference.excerptHash}`;
    if (!allowedReferences.has(key)) {
      issues.push(`evidence: unknown excerpt reference ${key}`);
    }
  }

  return issues;
}
