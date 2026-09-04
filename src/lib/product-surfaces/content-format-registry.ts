import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { contentFormatDefinitionRevisions } from "@/lib/db/schema";
import { contentFormatDefinition, type ContentFormatDefinition } from "./content-format-definition";
import type { ContentFormat } from "./definitions";

export class ContentFormatRegistryError extends Error {
  constructor(readonly code: "CONTENT_FORMAT_DEFINITION_UNAVAILABLE" | "CONTENT_FORMAT_DEFINITION_INVALID") {
    super(code);
  }
}

function sameStringSet(value: unknown, expected: readonly string[]) {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

export function validatePersistedContentFormatDefinition(value: unknown): ContentFormatDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ContentFormatRegistryError("CONTENT_FORMAT_DEFINITION_INVALID");
  const candidate = value as Partial<ContentFormatDefinition>;
  if (candidate.schema !== "content-format-definition/v1" || typeof candidate.id !== "string" || !Number.isInteger(candidate.revision) || candidate.status !== "active" || typeof candidate.format !== "string") throw new ContentFormatRegistryError("CONTENT_FORMAT_DEFINITION_INVALID");
  const builtin = contentFormatDefinition(candidate.format as ContentFormat);
  if (!builtin || candidate.id !== `content-format:${candidate.format}` || !candidate.layout || !sameStringSet(candidate.layout.aspectRatios, ["9:16"]) || candidate.layout.defaultAspectRatio !== "9:16" || !candidate.execution || !candidate.renderProof || candidate.renderProof.schema !== "content-render-proof/v1" || !sameStringSet(candidate.renderProof.verifies, ["fonts", "bidi", "captions", "timing", "safe_areas"]) || !candidate.editorHandoff?.requiresPassedRenderProof || !Array.isArray(candidate.controls) || !Array.isArray(candidate.requiredControls) || !Array.isArray(candidate.sourceSlots)) throw new ContentFormatRegistryError("CONTENT_FORMAT_DEFINITION_INVALID");
  return candidate as ContentFormatDefinition;
}

export async function resolveActiveContentFormatDefinition(format: ContentFormat) {
  const [row] = await getDb().select().from(contentFormatDefinitionRevisions).where(and(eq(contentFormatDefinitionRevisions.format, format), eq(contentFormatDefinitionRevisions.status, "active"))).orderBy(desc(contentFormatDefinitionRevisions.revision)).limit(1);
  if (!row) throw new ContentFormatRegistryError("CONTENT_FORMAT_DEFINITION_UNAVAILABLE");
  const definition = validatePersistedContentFormatDefinition(row.document);
  if (definition.id !== row.definitionId || definition.revision !== row.revision || definition.format !== row.format || canonicalDigest(definition) !== row.documentDigest) throw new ContentFormatRegistryError("CONTENT_FORMAT_DEFINITION_INVALID");
  return { definition, reference: { id: row.definitionId, revision: row.revision, digest: row.documentDigest } };
}
