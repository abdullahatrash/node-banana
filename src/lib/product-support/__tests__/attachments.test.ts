import { describe, expect, it } from "vitest";
import { SUPPORT_ATTACHMENT_MAX_BYTES, supportAttachmentReferencesSchema, validateSupportAttachmentCandidates } from "../attachment-policy";

const ready = (id: string, overrides: Record<string, unknown> = {}) => ({ id, type: "image", mimeType: "image/png", sizeBytes: 1024, checksum: `sha256:${id.charCodeAt(0).toString(16).padStart(2, "0").repeat(32)}`, metadata: { uploadState: "ready" }, ...overrides });
const at = new Date("2026-09-04T12:00:00.000Z");
describe("support attachment policy", () => {
  it("preserves caller order in canonical immutable references", () => {
    const refs = validateSupportAttachmentCandidates({ requestedIds: ["asset-b", "asset-a"], candidates: [ready("asset-a"), ready("asset-b")], capturedAt: at });
    expect(refs.map(({ assetId, order }) => ({ assetId, order }))).toEqual([{ assetId: "asset-b", order: 0 }, { assetId: "asset-a", order: 1 }]);
    expect(refs[0]).not.toHaveProperty("storageKey");
  });
  it.each([
    ["cross-workspace/deleted", ["missing"], [ready("asset-a")], "SUPPORT_ATTACHMENT_NOT_AVAILABLE"],
    ["not ready", ["asset-a"], [ready("asset-a", { metadata: { uploadState: "pending" } })], "SUPPORT_ATTACHMENT_NOT_READY"],
    ["unsupported", ["asset-a"], [ready("asset-a", { type: "workflow", mimeType: "application/json" })], "SUPPORT_ATTACHMENT_TYPE_UNSUPPORTED"],
    ["oversized", ["asset-a"], [ready("asset-a", { sizeBytes: SUPPORT_ATTACHMENT_MAX_BYTES + 1 })], "SUPPORT_ATTACHMENT_SIZE_EXCEEDED"],
    ["no digest", ["asset-a"], [ready("asset-a", { checksum: null })], "SUPPORT_ATTACHMENT_CHECKSUM_REQUIRED"],
  ])("rejects %s attachments", (_label, requestedIds, candidates, code) => {
    expect(() => validateSupportAttachmentCandidates({ requestedIds: requestedIds as string[], candidates: candidates as ReturnType<typeof ready>[], capturedAt: at })).toThrow(code as string);
  });
  it("enforces count, uniqueness, and aggregate byte ceilings", () => {
    const six = Array.from({ length: 6 }, (_, index) => `asset-${index}`);
    expect(() => validateSupportAttachmentCandidates({ requestedIds: six, candidates: six.map((id) => ready(id)), capturedAt: at })).toThrow("SUPPORT_ATTACHMENT_COUNT_EXCEEDED");
    expect(() => validateSupportAttachmentCandidates({ requestedIds: ["asset-a", "asset-a"], candidates: [ready("asset-a")], capturedAt: at })).toThrow("SUPPORT_ATTACHMENT_DUPLICATE");
    expect(() => validateSupportAttachmentCandidates({ requestedIds: ["asset-a", "asset-b", "asset-c"], candidates: [ready("asset-a", { sizeBytes: 20 * 1024 * 1024 }), ready("asset-b", { sizeBytes: 20 * 1024 * 1024 }), ready("asset-c", { sizeBytes: 20 * 1024 * 1024 })], capturedAt: at })).toThrow("SUPPORT_ATTACHMENT_TOTAL_SIZE_EXCEEDED");
  });
  it("rejects non-canonical durable reference arrays", () => {
    const refs = validateSupportAttachmentCandidates({ requestedIds: ["asset-a", "asset-b"], candidates: [ready("asset-a"), ready("asset-b")], capturedAt: at });
    expect(() => supportAttachmentReferencesSchema.parse([{ ...refs[0], order: 1 }])).toThrow();
    expect(() => supportAttachmentReferencesSchema.parse([refs[0], { ...refs[1], assetId: refs[0].assetId }])).toThrow();
    const atLimit = refs.map((ref) => ({ ...ref, sizeBytes: 25 * 1024 * 1024 }));
    expect(() => supportAttachmentReferencesSchema.parse(atLimit)).not.toThrow();
    expect(() => supportAttachmentReferencesSchema.parse([...atLimit, { ...refs[1], assetId: "asset-c", order: 2, sizeBytes: 1 }])).toThrow();
  });
});
