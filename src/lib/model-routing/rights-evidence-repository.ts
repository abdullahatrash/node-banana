import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { inspirationRightsEvidence as evidenceTable } from "./db-schema";
import { hydrateRightsEvidence, rightsEvidenceDigest, validateRightsEvidence } from "./rights-evidence";
import type { InspirationRightsEvidence } from "./types";

const stableId = (workspaceId: string, key: string) => `rte_${createHash("sha256").update(`${workspaceId}:${key}`).digest("hex").slice(0, 32)}`;

export async function createImmutableRightsEvidence(input: {
  workspaceId: string; userId: string; idempotencyKey: string; sourceAssetId: string;
  basis: InspirationRightsEvidence["basis"]; permittedRemix: InspirationRightsEvidence["permittedRemix"];
  issuer: InspirationRightsEvidence["issuer"]; scope: InspirationRightsEvidence["scope"];
  evidenceDocumentAssetId: string | null; sourceUrl: string | null; issuedAt: Date; expiresAt: Date | null; at: Date;
}): Promise<{ kind: "created" | "replayed"; evidence: InspirationRightsEvidence } | { kind: "invalid" | "conflict"; code: string }> {
  const ids = [input.sourceAssetId, input.evidenceDocumentAssetId].filter((value): value is string => Boolean(value));
  const rows = await getDb().select({ id: assets.id, checksum: assets.checksum, metadata: assets.metadata, createdByUserId: assets.createdByUserId }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), inArray(assets.id, ids), isNull(assets.deletedAt)));
  const selected = rows.filter((row) => ids.includes(row.id)); const source = selected.find((row) => row.id === input.sourceAssetId); const document = input.evidenceDocumentAssetId ? selected.find((row) => row.id === input.evidenceDocumentAssetId) : null;
  const ready = (row: typeof source | null) => row && typeof row.checksum === "string" && /^sha256:[a-f0-9]{64}$/.test(row.checksum) && row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) && row.metadata.uploadState === "ready";
  if (!ready(source) || (input.evidenceDocumentAssetId && !ready(document))) return { kind: "invalid", code: "RIGHTS_EVIDENCE_ASSET_NOT_READY" };
  if (input.basis === "owned" && (input.issuer.type !== "workspace_asset_owner" || input.issuer.id !== source!.createdByUserId || input.evidenceDocumentAssetId || input.sourceUrl)) return { kind: "invalid", code: "OWNERSHIP_ISSUER_MISMATCH" };
  if (input.basis !== "owned" && (!input.evidenceDocumentAssetId || !input.sourceUrl || input.issuer.type === "workspace_asset_owner")) return { kind: "invalid", code: "THIRD_PARTY_RIGHTS_DOCUMENT_REQUIRED" };
  const id = stableId(input.workspaceId, input.idempotencyKey);
  const unsigned = { schema: "inspiration-rights-evidence/v1" as const, id, workspaceId: input.workspaceId, sourceAssetId: input.sourceAssetId, sourceDigest: source!.checksum as `sha256:${string}`, basis: input.basis, permittedRemix: input.permittedRemix, issuer: input.issuer, verifier: { type: "workspace_member" as const, userId: input.userId }, scope: input.scope, evidenceDocumentAssetId: input.evidenceDocumentAssetId, sourceUrl: input.sourceUrl, issuedAt: input.issuedAt, verifiedAt: input.at, expiresAt: input.expiresAt };
  const evidence = { ...unsigned, digest: rightsEvidenceDigest(unsigned) };
  if (!validateRightsEvidence({ workspaceId: input.workspaceId, basis: input.basis, permittedRemix: input.permittedRemix, sourceAssetIds: [input.sourceAssetId], evidence: [evidence], at: input.at }).ok) return { kind: "invalid", code: "RIGHTS_EVIDENCE_INVALID" };
  const [created] = await getDb().insert(evidenceTable).values({ workspaceId: input.workspaceId, id, sourceAssetId: input.sourceAssetId, sourceDigest: evidence.sourceDigest, evidence, digest: evidence.digest, basis: evidence.basis, permittedRemix: evidence.permittedRemix, evidenceDocumentAssetId: evidence.evidenceDocumentAssetId, issuerType: evidence.issuer.type, issuerId: evidence.issuer.id, verifiedByUserId: input.userId, issuedAt: evidence.issuedAt, verifiedAt: evidence.verifiedAt, expiresAt: evidence.expiresAt, createdAt: input.at }).onConflictDoNothing().returning({ evidence: evidenceTable.evidence });
  if (created) return { kind: "created", evidence: hydrateRightsEvidence(created.evidence) };
  const [existing] = await getDb().select({ evidence: evidenceTable.evidence }).from(evidenceTable).where(and(eq(evidenceTable.workspaceId, input.workspaceId), eq(evidenceTable.id, id))).limit(1);
  if (!existing || canonicalDigest(existing.evidence) !== canonicalDigest(evidence)) return { kind: "conflict", code: "RIGHTS_EVIDENCE_IDEMPOTENCY_CONFLICT" };
  return { kind: "replayed", evidence: hydrateRightsEvidence(existing.evidence) };
}

export async function loadRightsEvidence(workspaceId: string, ids: string[]): Promise<InspirationRightsEvidence[]> {
  if (!ids.length) return [];
  const rows = await getDb().select({ evidence: evidenceTable.evidence }).from(evidenceTable).where(and(eq(evidenceTable.workspaceId, workspaceId), inArray(evidenceTable.id, ids)));
  const selected = rows.map((row) => hydrateRightsEvidence(row.evidence)).filter((value) => ids.includes(value.id));
  return ids.map((id) => selected.find((value) => value.id === id)).filter((value): value is InspirationRightsEvidence => Boolean(value));
}
