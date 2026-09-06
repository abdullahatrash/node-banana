import { z } from "zod";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { CreativeError, digestSchema } from "./contracts";
import type { CreativeSession, CreativeVisualReview } from "./session";

const detectionSchema = z.object({
  schema: z.literal("creative-plate-inspection/v1"),
  plateDigest: digestSchema,
  detectorId: z.string().min(1).max(200), detectorVersion: z.string().min(1).max(200),
  findings: z.array(z.object({ kind: z.enum(["text", "watermark", "protected_mark"]), confidence: z.number().min(0).max(1) }).strict()).max(1000),
}).strict();

export interface CreativePlateInspector {
  inspect(input: { workspaceId: string; assetId: string; plateDigest: string }): Promise<unknown>;
}

/** An unavailable detector is visible review evidence, never a fabricated
 * clean result. No detector implementation is allowed to regenerate media. */
export async function inspectCreativePlate(inspector: CreativePlateInspector, input: { workspaceId: string; assetId: string; plateDigest: string }): Promise<CreativeVisualReview> {
  let raw: unknown = null;
  try { raw = await inspector.inspect(input); } catch { /* preserve an unavailable warning */ }
  const parsed = detectionSchema.safeParse(raw);
  const report = parsed.success && parsed.data.plateDigest === input.plateDigest ? parsed.data : null;
  const findings = report?.findings ?? [];
  const status = !report ? "unavailable" : findings.some((finding) => finding.kind !== "text" && finding.confidence >= 0.9) ? "rejected" : findings.length ? "warning" : "clear";
  return { schema: "creative-visual-review/v1", plateDigest: input.plateDigest, detection: { status, detectorId: report?.detectorId ?? null, detectorVersion: report?.detectorVersion ?? null, evidenceDigest: report ? canonicalDigest(report) : null, findings }, decision: status === "rejected" ? "rejected" : "pending", reviewerUserId: null, reviewedAt: null, acknowledgedFindingsDigest: null };
}

export function acceptVisualReview(review: CreativeVisualReview, input: { plateDigest: string; acknowledgedFindingsDigest: string; userId: string; at: string }): CreativeVisualReview {
  if (review.plateDigest !== input.plateDigest || review.detection.status === "rejected" || input.acknowledgedFindingsDigest !== canonicalDigest(review.detection)) throw new CreativeError("creative.errors.visualReviewRequired");
  return { ...review, decision: "accepted", reviewerUserId: input.userId, reviewedAt: input.at, acknowledgedFindingsDigest: input.acknowledgedFindingsDigest };
}

export function assertCreativePublishable(session: CreativeSession) {
  if (session.cancellationRequestedAt) throw new CreativeError("creative.errors.cancelled");
  if (!session.copy || session.copyApproval?.digest !== canonicalDigest(session.copy)) throw new CreativeError("creative.errors.copyApprovalRequired");
  if (!session.plate || session.visualReview?.plateDigest !== session.plate.digest || session.visualReview.decision !== "accepted" || session.visualReview.detection.status === "rejected") throw new CreativeError("creative.errors.visualReviewRequired");
  if (!session.composition || !session.output || session.output.receipt.compositionDigest !== canonicalDigest(session.composition) || session.output.receipt.copyDigest !== canonicalDigest(session.copy) || session.output.receipt.plate.digest !== session.plate.digest || session.output.digest !== session.output.receipt.output.digest) throw new CreativeError("creative.errors.renderRequired");
  if (session.publicationReview?.outputDigest !== session.output.digest || session.publicationReview.compositionDigest !== canonicalDigest(session.composition)) throw new CreativeError("creative.errors.publicationReviewRequired");
}

export function creativeHandoff(session: CreativeSession) {
  assertCreativePublishable(session);
  return {
    schema: "creative-handoff/v1" as const,
    workspaceId: session.workspaceId,
    sessionId: session.id,
    sessionRevision: session.revision,
    assetId: session.output!.assetId,
    assetDigest: session.output!.digest,
    brand: session.request.brand,
    rights: session.request.rights,
    copy: session.copy!,
    composition: session.composition!,
    generationIntentIds: session.stages.map((stage) => stage.intentId),
    renderReceiptDigest: session.output!.receipt.digest,
    review: session.publicationReview!,
    links: { media: `/simple-studio/library?asset=${encodeURIComponent(session.output!.assetId)}`, editor: `/editor?asset=${encodeURIComponent(session.output!.assetId)}`, composer: `/social/compose?asset=${encodeURIComponent(session.output!.assetId)}` },
  };
}
