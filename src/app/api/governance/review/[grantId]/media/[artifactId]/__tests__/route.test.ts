import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getResource: vi.fn(),
  readRetainedBytes: vi.fn(),
}));

vi.mock("@/lib/governance/production", () => ({
  PRODUCTION_GOVERNANCE_REPOSITORY: { getResource: mocks.getResource },
}));
vi.mock("@/lib/agent-runtime/publishing-approvals/audit-artifacts", () => ({
  PRODUCTION_PUBLISHING_APPROVAL_AUDIT_ARTIFACTS: { readRetainedBytes: mocks.readRetainedBytes },
}));

import { sealReviewMediaToken, type ReviewMediaTokenPayload } from "@/lib/governance/review-presentation";
import { GET } from "../route";

const signingKey = Buffer.alloc(32, 7);
const media: ReviewMediaTokenPayload = {
  schema: "governance-review-media-token/v1",
  workspaceId: "workspace-a",
  grantId: "grant-a",
  sessionId: "session-a",
  purpose: "inspect",
  resourceKind: "render_proof",
  resourceId: "proof-a",
  reviewRevisionDigest: `sha256:${"a".repeat(64)}`,
  artifactId: "artifact-a",
  revisionDigest: `sha256:${"b".repeat(64)}`,
  evidence: { id: "artifact-a", digest: `sha256:${"b".repeat(64)}`, snapshotDigest: `sha256:${"c".repeat(64)}`, kind: "image", mediaType: "image/png", sizeBytes: 3 },
  expiresAt: "2099-09-04T12:15:00.000Z",
};

function request() {
  const access = sealReviewMediaToken(media, signingKey);
  return new NextRequest(`http://localhost/api/governance/review/grant-a/media/artifact-a?access=${encodeURIComponent(access)}`);
}

function context() {
  return { params: Promise.resolve({ grantId: "grant-a", artifactId: "artifact-a" }) };
}

function authorizeCurrent() {
  mocks.getResource.mockImplementation(async (input: { kind: string }) => input.kind === "review_guest_session"
    ? { id: "session-a", status: "active", body: { grantId: "grant-a", purpose: "inspect", resourceKind: "render_proof", resourceId: "proof-a", revisionDigest: media.reviewRevisionDigest, expiresAt: "2099-09-04T13:00:00.000Z" } }
    : { id: "grant-a", status: "pending_verification", body: { purpose: "inspect", resourceKind: "render_proof", resourceId: "proof-a", revisionDigest: media.reviewRevisionDigest, expiresAt: "2099-09-04T13:00:00.000Z", revokedAt: null } });
}

describe("Review Guest media route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOVERNANCE_REVIEW_MEDIA_SIGNING_KEY = signingKey.toString("base64");
    authorizeCurrent();
    mocks.readRetainedBytes.mockResolvedValue(Uint8Array.from([1, 2, 3]));
  });

  it("serves retained bytes only after live exact reauthorization", async () => {
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(mocks.getResource).toHaveBeenCalledTimes(2);
    expect(mocks.readRetainedBytes).toHaveBeenCalledOnce();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("invalidates an otherwise unexpired URL immediately after grant revocation", async () => {
    mocks.getResource.mockImplementation(async (input: { kind: string }) => input.kind === "review_guest_session"
      ? { id: "session-a", status: "active", body: { grantId: "grant-a", purpose: "inspect", resourceKind: "render_proof", resourceId: "proof-a", revisionDigest: media.reviewRevisionDigest, expiresAt: "2099-09-04T13:00:00.000Z" } }
      : { id: "grant-a", status: "revoked", body: { purpose: "inspect", resourceKind: "render_proof", resourceId: "proof-a", revisionDigest: media.reviewRevisionDigest, expiresAt: "2099-09-04T13:00:00.000Z", revokedAt: new Date().toISOString() } });

    const response = await GET(request(), context());
    expect(response.status).toBe(404);
    expect(mocks.readRetainedBytes).not.toHaveBeenCalled();
  });
});
