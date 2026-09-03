import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { artifactContents, artifacts } from "@/lib/db/schema";
import {
  PRODUCTION_PUBLISHING_APPROVAL_PRESENTATION,
  PRODUCTION_PUBLISHING_APPROVAL_REPOSITORY,
  PRODUCTION_PUBLISHING_APPROVAL_REVISIONS,
} from "@/lib/agent-runtime/publishing-approvals/production";
import type { PublishingApprovalArtifactEvidence } from "@/lib/agent-runtime/publishing-approvals/audit-artifacts";
import type { GovernanceReviewPresentation, GovernanceReviewPresentationPort } from "./types";

const MAX_MEDIA_ACCESS_MS = 15 * 60_000;

export interface ReviewMediaTokenPayload {
  schema: "governance-review-media-token/v1";
  workspaceId: string;
  grantId: string;
  sessionId: string;
  artifactId: string;
  revisionDigest: string;
  evidence: PublishingApprovalArtifactEvidence;
  expiresAt: string;
}

function reviewKey(value = process.env.GOVERNANCE_REVIEW_MEDIA_SIGNING_KEY): Buffer | null {
  const key = Buffer.from(value ?? "", "base64");
  return key.length === 32 ? key : null;
}

export function sealReviewMediaToken(payload: ReviewMediaTokenPayload, key: Uint8Array): string {
  const encoded = Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function openReviewMediaToken(token: string, input: { grantId: string; artifactId: string; now?: Date; key?: Uint8Array }): ReviewMediaTokenPayload | null {
  const [encoded, signature, extra] = token.split(".");
  const key = input.key ?? reviewKey();
  if (!encoded || !signature || extra || !key) return null;
  const expected = createHmac("sha256", key).update(encoded).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "base64url"); } catch { return null; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ReviewMediaTokenPayload;
    if (
      payload.schema !== "governance-review-media-token/v1" ||
      payload.grantId !== input.grantId || payload.artifactId !== input.artifactId ||
      payload.evidence.id !== input.artifactId || payload.evidence.digest !== payload.revisionDigest ||
      new Date(payload.expiresAt) <= (input.now ?? new Date())
    ) return null;
    return payload;
  } catch { return null; }
}

export class DrizzleGovernanceReviewPresentationPort implements GovernanceReviewPresentationPort {
  constructor(
    private readonly getDatabase: () => ReturnType<typeof getDb> = getDb,
    private readonly signingKey: Uint8Array | null = reviewKey(),
  ) {}

  async present(input: Parameters<GovernanceReviewPresentationPort["present"]>[0]): Promise<GovernanceReviewPresentation | null> {
    const expiresAt = new Date(Math.min(input.sessionExpiresAt.getTime(), input.presentedAt.getTime() + MAX_MEDIA_ACCESS_MS));
    if (input.resourceKind === "render_proof") {
      const [row] = await this.getDatabase().select({
        id: artifacts.id,
        digest: artifactContents.digest,
        kind: artifactContents.kind,
        mediaType: artifactContents.mediaType,
        sizeBytes: artifactContents.sizeBytes,
        inlineText: artifactContents.inlineText,
      }).from(artifacts).innerJoin(artifactContents, and(
        eq(artifactContents.workspaceId, artifacts.workspaceId),
        eq(artifactContents.digest, artifacts.contentDigest),
      )).where(and(
        eq(artifacts.workspaceId, input.workspaceId),
        eq(artifacts.id, input.resourceId),
        eq(artifacts.contentDigest, input.revisionDigest),
      )).limit(1);
      if (!row || (row.kind !== "text" && row.kind !== "image")) return null;
      const evidence: PublishingApprovalArtifactEvidence = {
        id: row.id, digest: row.digest, kind: row.kind, mediaType: row.mediaType,
        sizeBytes: row.sizeBytes, snapshotDigest: canonicalDigest(row),
      };
      if (row.kind === "image" && !this.signingKey) return null;
      const mediaAccess = row.kind === "image" ? this.mediaAccess(input, evidence, expiresAt) : null;
      const unsigned = {
        schema: "governance-review-presentation/v1" as const,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        revisionDigest: input.revisionDigest,
        purpose: input.purpose,
        presentedAt: input.presentedAt.toISOString(),
        expiresAt: input.sessionExpiresAt.toISOString(),
        renderProof: { artifactId: row.id, kind: row.kind as "text" | "image", mediaType: row.mediaType, sizeBytes: row.sizeBytes, text: row.kind === "text" ? row.inlineText : null, mediaAccess },
        planRevision: null,
      };
      return { ...unsigned, presentationDigest: canonicalDigest(unsigned) };
    }

    if (!input.approvalRequestId) return null;
    const approval = await PRODUCTION_PUBLISHING_APPROVAL_REPOSITORY.getRequest({ workspaceId: input.workspaceId, approvalRequestId: input.approvalRequestId });
    if (!approval || approval.planRevisionId !== input.resourceId || approval.planRevisionDigest !== input.revisionDigest) return null;
    const revision = await PRODUCTION_PUBLISHING_APPROVAL_REVISIONS.getCurrentRevision({ workspaceId: input.workspaceId, revisionId: input.resourceId });
    if (!revision || revision.definitionDigest !== input.revisionDigest) return null;
    const targets = await PRODUCTION_PUBLISHING_APPROVAL_PRESENTATION.present({ approval, revision, actorUserId: approval.requestingPrincipalId, presentedAt: input.presentedAt });
    if (targets.some((target) => target.media.length > 0) && !this.signingKey) return null;
    const projectedTargets = targets.map((target) => ({
      targetId: target.targetId,
      targetEvidenceDigest: target.targetEvidenceDigest,
      channel: target.channel,
      content: { artifactId: target.content.artifactId, digest: target.content.digest, text: target.content.text },
      media: target.media.map((media) => {
        const evidence = target.validation.artifacts.media.find((candidate) => candidate.id === media.artifactId && candidate.digest === media.digest);
        if (!evidence) throw new Error("Approved media evidence is unavailable.");
        return { artifactId: media.artifactId, digest: media.digest, mediaType: media.mediaType, sizeBytes: evidence.sizeBytes, access: this.mediaAccess(input, evidence, expiresAt)! };
      }),
      settings: target.settings,
      timing: target.timing,
      validationExpiresAt: target.validation.expiresAt,
    }));
    const unsigned = {
      schema: "governance-review-presentation/v1" as const,
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      revisionDigest: input.revisionDigest,
      purpose: input.purpose,
      presentedAt: input.presentedAt.toISOString(),
      expiresAt: input.sessionExpiresAt.toISOString(),
      renderProof: null,
      planRevision: { planRevisionId: revision.id, planRevision: revision.revision, planRevisionDigest: revision.definitionDigest, targets: projectedTargets },
    };
    return { ...unsigned, presentationDigest: canonicalDigest(unsigned) };
  }

  private mediaAccess(input: Parameters<GovernanceReviewPresentationPort["present"]>[0], evidence: PublishingApprovalArtifactEvidence, expiresAt: Date) {
    if (!this.signingKey) return null;
    const payload: ReviewMediaTokenPayload = {
      schema: "governance-review-media-token/v1",
      workspaceId: input.workspaceId,
      grantId: input.grantId,
      sessionId: input.sessionId,
      artifactId: evidence.id,
      revisionDigest: evidence.digest,
      evidence,
      expiresAt: expiresAt.toISOString(),
    };
    const token = sealReviewMediaToken(payload, this.signingKey);
    return { url: `/api/governance/review/${encodeURIComponent(input.grantId)}/media/${encodeURIComponent(evidence.id)}?access=${encodeURIComponent(token)}`, expiresAt: payload.expiresAt, digest: canonicalDigest(payload) };
  }
}
