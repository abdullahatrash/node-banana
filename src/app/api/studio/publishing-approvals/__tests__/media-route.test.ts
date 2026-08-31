import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockInspectForHuman = vi.fn();
const mockReadArtifactBytes = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => true,
  getDb: vi.fn(),
}));

vi.mock("@/lib/studio/authz", () => ({
  authorizeStudioRequest: (...args: unknown[]) =>
    mockAuthorizeStudioRequest(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json(
      { success: false, error: result.error },
      { status: result.status },
    ),
}));

vi.mock("@/lib/agent-runtime/publishing-approvals/production", () => ({
  PRODUCTION_PUBLISHING_APPROVAL_SERVICE: {
    inspectForHuman: (...args: unknown[]) => mockInspectForHuman(...args),
  },
}));

vi.mock("@/lib/agent-runtime/publishing-approvals/audit-artifacts", () => ({
  PRODUCTION_PUBLISHING_APPROVAL_AUDIT_ARTIFACTS: {
    readRetainedBytes: (...args: unknown[]) => mockReadArtifactBytes(...args),
  },
}));

import { GET } from "../[approvalRequestId]/media/[artifactId]/route";

function request() {
  return new NextRequest(
    "http://localhost:3000/api/studio/publishing-approvals/par_1/media/image_1",
    { headers: { "x-workspace-id": "workspace_1" } },
  );
}

describe("Publishing Approval exact media proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "human_1",
      workspaceId: "workspace_1",
      role: "owner",
    });
    mockInspectForHuman.mockResolvedValue({
      targets: [
        {
          media: [
            {
              artifactId: "image_1",
              digest: `sha256:${"a".repeat(64)}`,
              mediaType: "image/png",
              previewUrl:
                "/api/studio/publishing-approvals/par_1/media/image_1",
            },
          ],
          validation: {
            artifacts: {
              media: [
                {
                  id: "image_1",
                  digest: `sha256:${"a".repeat(64)}`,
                  snapshotDigest: `sha256:${"b".repeat(64)}`,
                  kind: "image",
                  mediaType: "image/png",
                  sizeBytes: 3,
                },
              ],
            },
          },
        },
      ],
    });
    mockReadArtifactBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  it("streams retained exact media after the live Artifact was soft-deleted", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({
        approvalRequestId: "par_1",
        artifactId: "image_1",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mockReadArtifactBytes).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      evidence: {
        id: "image_1",
        digest: `sha256:${"a".repeat(64)}`,
        snapshotDigest: `sha256:${"b".repeat(64)}`,
        kind: "image",
        mediaType: "image/png",
        sizeBytes: 3,
      },
    });
  });

  it("does not expose an Artifact outside the exact Approval presentation", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({
        approvalRequestId: "par_1",
        artifactId: "image_other",
      }),
    });

    expect(response.status).toBe(404);
    expect(mockReadArtifactBytes).not.toHaveBeenCalled();
  });

  it("redacts retained-storage failures and always disables caching", async () => {
    mockReadArtifactBytes.mockRejectedValueOnce(
      new Error("s3://secret-bucket/internal/storage-key"),
    );

    const response = await GET(request(), {
      params: Promise.resolve({
        approvalRequestId: "par_1",
        artifactId: "image_1",
      }),
    });
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain("temporarily unavailable");
    expect(body).not.toMatch(/secret-bucket|storage-key|s3:/);
  });
});
