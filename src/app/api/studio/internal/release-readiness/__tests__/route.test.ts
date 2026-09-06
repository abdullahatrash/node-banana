import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const readiness = { schema: "release-readiness-decision/v1", buildId: "build-1", evaluatedAt: new Date("2026-09-04T00:00:00.000Z"), releasable: true, parityClaimAllowed: true, parityMatrix: { requiredCells: 2, passingCells: 2 }, blockers: [] };
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/release-control/production", () => ({ getReleaseControlService: () => ({ readiness: vi.fn(async () => readiness) }) }));

describe("internal release readiness gate", () => {
  beforeEach(() => { process.env.RELEASE_DEPLOYMENT_GATE_SECRET = "deployment-gate-secret-at-least-32-bytes"; process.env.RELEASE_READINESS_SIGNING_SECRET = "readiness-signing-secret-at-least-32-bytes"; process.env.RELEASE_READINESS_SIGNING_KEY_ID = "release-key"; });
  it("rejects requests without the deployment bearer", async () => { const { GET } = await import("../route"); const response = await GET(new NextRequest("http://localhost/api/studio/internal/release-readiness?workspaceId=workspace-1")); expect(response.status).toBe(401); });
  it("returns a signed, manifest-bound passing decision", async () => { const { GET } = await import("../route"); const response = await GET(new NextRequest("http://localhost/api/studio/internal/release-readiness?workspaceId=workspace-1", { headers: { authorization: `Bearer ${process.env.RELEASE_DEPLOYMENT_GATE_SECRET}` } })); const body = await response.json(); expect(response.status).toBe(200); expect(body).toMatchObject({ success: true, readiness: { buildId: "build-1", parityMatrix: { requiredCells: 2, passingCells: 2 } }, attestation: { schema: "release-readiness-attestation/v1", keyId: "release-key", buildId: "build-1" } }); expect(body.attestation.signature).toMatch(/^hmac-sha256:[a-f0-9]{64}$/); });
});
