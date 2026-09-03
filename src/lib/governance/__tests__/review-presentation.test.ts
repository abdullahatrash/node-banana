import { describe, expect, it } from "vitest";
import { openReviewMediaToken, sealReviewMediaToken, type ReviewMediaTokenPayload } from "../review-presentation";

const key = Buffer.alloc(32, 9);
const payload: ReviewMediaTokenPayload = {
  schema: "governance-review-media-token/v1",
  workspaceId: "workspace-a",
  grantId: "review-a",
  sessionId: "session-a",
  artifactId: "artifact-a",
  revisionDigest: `sha256:${"a".repeat(64)}`,
  evidence: { id: "artifact-a", digest: `sha256:${"a".repeat(64)}`, snapshotDigest: `sha256:${"b".repeat(64)}`, kind: "image", mediaType: "image/png", sizeBytes: 12 },
  expiresAt: "2026-09-04T12:15:00.000Z",
};

describe("review media access", () => {
  it("opens only an unexpired exact grant, artifact, and digest-bound token", () => {
    const token = sealReviewMediaToken(payload, key);
    expect(openReviewMediaToken(token, { grantId: "review-a", artifactId: "artifact-a", now: new Date("2026-09-04T12:00:00.000Z"), key })).toEqual(payload);
    expect(openReviewMediaToken(token, { grantId: "review-b", artifactId: "artifact-a", now: new Date("2026-09-04T12:00:00.000Z"), key })).toBeNull();
    expect(openReviewMediaToken(token, { grantId: "review-a", artifactId: "artifact-b", now: new Date("2026-09-04T12:00:00.000Z"), key })).toBeNull();
    expect(openReviewMediaToken(token, { grantId: "review-a", artifactId: "artifact-a", now: new Date("2026-09-04T12:16:00.000Z"), key })).toBeNull();
    expect(openReviewMediaToken(`${token.slice(0, -1)}x`, { grantId: "review-a", artifactId: "artifact-a", now: new Date("2026-09-04T12:00:00.000Z"), key })).toBeNull();
  });
});
