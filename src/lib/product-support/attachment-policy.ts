import { z } from "zod";

export const SUPPORT_ATTACHMENT_MAX_COUNT = 5;
export const SUPPORT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const SUPPORT_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024;
export const SUPPORT_ATTACHMENT_TYPES = ["image", "video", "audio"] as const;

export const supportAttachmentReferenceSchema = z.object({
  assetId: z.string().trim().min(1).max(200),
  order: z.number().int().min(0).max(SUPPORT_ATTACHMENT_MAX_COUNT - 1),
  assetType: z.enum(SUPPORT_ATTACHMENT_TYPES),
  mimeType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive().max(SUPPORT_ATTACHMENT_MAX_BYTES),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  capturedAt: z.string().datetime(),
}).strict();

export const supportAttachmentReferencesSchema = z.array(supportAttachmentReferenceSchema)
  .max(SUPPORT_ATTACHMENT_MAX_COUNT)
  .superRefine((references, context) => {
    const assetIds = new Set<string>();
    let totalBytes = 0;
    references.forEach((reference, index) => {
      if (reference.order !== index) {
        context.addIssue({ code: "custom", path: [index, "order"], message: "Attachment order must be contiguous and match its position." });
      }
      if (assetIds.has(reference.assetId)) {
        context.addIssue({ code: "custom", path: [index, "assetId"], message: "Attachment asset references must be unique." });
      }
      assetIds.add(reference.assetId);
      totalBytes += reference.sizeBytes;
    });
    if (totalBytes > SUPPORT_ATTACHMENT_TOTAL_BYTES) {
      context.addIssue({ code: "custom", message: "Attachment references exceed the aggregate byte limit." });
    }
  });

export type SupportAttachmentReference = z.infer<typeof supportAttachmentReferenceSchema>;
export type SupportAttachmentCandidate = {
  id: string;
  type: string;
  mimeType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  metadata: Record<string, unknown> | null;
};

export class SupportAttachmentPolicyError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export function validateSupportAttachmentCandidates(input: { requestedIds: string[]; candidates: SupportAttachmentCandidate[]; capturedAt: Date }) {
  const requestedIds = input.requestedIds.map((id) => id.trim()).filter(Boolean);
  if (requestedIds.length > SUPPORT_ATTACHMENT_MAX_COUNT) throw new SupportAttachmentPolicyError("SUPPORT_ATTACHMENT_COUNT_EXCEEDED");
  if (new Set(requestedIds).size !== requestedIds.length) throw new SupportAttachmentPolicyError("SUPPORT_ATTACHMENT_DUPLICATE");
  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  if (requestedIds.some((id) => !byId.has(id))) throw new SupportAttachmentPolicyError("SUPPORT_ATTACHMENT_NOT_AVAILABLE");
  let totalBytes = 0;
  const references = requestedIds.map((assetId, order): SupportAttachmentReference => {
    const candidate = byId.get(assetId)!;
    if (!SUPPORT_ATTACHMENT_TYPES.includes(candidate.type as (typeof SUPPORT_ATTACHMENT_TYPES)[number])) throw new SupportAttachmentPolicyError("SUPPORT_ATTACHMENT_TYPE_UNSUPPORTED");
    if (candidate.metadata?.uploadState !== "ready") throw new SupportAttachmentPolicyError("SUPPORT_ATTACHMENT_NOT_READY");
    if (!candidate.mimeType || !candidate.mimeType.startsWith(`${candidate.type}/`)) throw new SupportAttachmentPolicyError("SUPPORT_ATTACHMENT_MIME_INVALID");
    if (!candidate.sizeBytes || candidate.sizeBytes > SUPPORT_ATTACHMENT_MAX_BYTES) throw new SupportAttachmentPolicyError("SUPPORT_ATTACHMENT_SIZE_EXCEEDED");
    if (!candidate.checksum || !/^sha256:[a-f0-9]{64}$/.test(candidate.checksum)) throw new SupportAttachmentPolicyError("SUPPORT_ATTACHMENT_CHECKSUM_REQUIRED");
    totalBytes += candidate.sizeBytes;
    if (totalBytes > SUPPORT_ATTACHMENT_TOTAL_BYTES) throw new SupportAttachmentPolicyError("SUPPORT_ATTACHMENT_TOTAL_SIZE_EXCEEDED");
    return supportAttachmentReferenceSchema.parse({ assetId, order, assetType: candidate.type, mimeType: candidate.mimeType, sizeBytes: candidate.sizeBytes, checksum: candidate.checksum, capturedAt: input.capturedAt.toISOString() });
  });
  return supportAttachmentReferencesSchema.parse(references);
}
