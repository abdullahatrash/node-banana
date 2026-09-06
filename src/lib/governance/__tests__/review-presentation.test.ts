import { describe, expect, it } from "vitest";
import type { GovernanceRepository, GovernanceResource } from "../types";
import { openReviewMediaToken, reauthorizeReviewMediaAccess, sealReviewMediaToken, type ReviewMediaTokenPayload } from "../review-presentation";

const key = Buffer.alloc(32, 9);
const payload: ReviewMediaTokenPayload = {
  schema: "governance-review-media-token/v1",
  workspaceId: "workspace-a",
  grantId: "review-a",
  sessionId: "session-a",
  purpose: "inspect",
  resourceKind: "render_proof",
  resourceId: "artifact-a",
  reviewRevisionDigest: `sha256:${"a".repeat(64)}`,
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

  it("reauthorizes the live exact grant, session, purpose, and review revision", async () => {
    const resource = (kind: "review_guest_grant" | "review_guest_session", status: string, body: Record<string, unknown>): GovernanceResource => ({
      id: kind === "review_guest_grant" ? payload.grantId : payload.sessionId,
      workspaceId: payload.workspaceId,
      kind,
      version: 1,
      status,
      body,
      createdByUserId: null,
      createdAt: new Date("2026-09-04T11:00:00.000Z"),
      updatedAt: new Date("2026-09-04T11:00:00.000Z"),
    });
    const grantBody = { purpose: payload.purpose, resourceKind: payload.resourceKind, resourceId: payload.resourceId, revisionDigest: payload.reviewRevisionDigest, expiresAt: "2026-09-04T13:00:00.000Z", revokedAt: null };
    const sessionBody = { grantId: payload.grantId, purpose: payload.purpose, resourceKind: payload.resourceKind, resourceId: payload.resourceId, revisionDigest: payload.reviewRevisionDigest, expiresAt: "2026-09-04T13:00:00.000Z" };
    let grant = resource("review_guest_grant", "pending_verification", grantBody);
    let session = resource("review_guest_session", "active", sessionBody);
    const repository = { getResource: async (input: { kind: string }) => input.kind === "review_guest_grant" ? grant : session } as Pick<GovernanceRepository, "getResource">;
    const now = new Date("2026-09-04T12:00:00.000Z");

    await expect(reauthorizeReviewMediaAccess(payload, repository, now)).resolves.toBe(true);
    grant = { ...grant, status: "revoked", body: { ...grantBody, revokedAt: now.toISOString() } };
    await expect(reauthorizeReviewMediaAccess(payload, repository, now)).resolves.toBe(false);
    grant = resource("review_guest_grant", "pending_verification", grantBody);
    session = { ...session, body: { ...sessionBody, purpose: "comment" } };
    await expect(reauthorizeReviewMediaAccess(payload, repository, now)).resolves.toBe(false);
    session = { ...session, body: { ...sessionBody, revisionDigest: `sha256:${"c".repeat(64)}` } };
    await expect(reauthorizeReviewMediaAccess(payload, repository, now)).resolves.toBe(false);
  });
});
