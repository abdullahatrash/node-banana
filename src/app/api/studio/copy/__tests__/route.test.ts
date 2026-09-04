import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/studio/authz", () => ({ authorizeStudioRequest: vi.fn(async () => ({ authorized: true, workspaceId: "ws", userId: "u", role: "owner", contentSession: { planTier: "enterprise" } })), authzErrorResponse: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => ({})), isDatabaseConfigured: () => true, schema: {} }));
import { POST } from "../route";

const request = (body: unknown) => ({ headers: new Headers({ "x-workspace-id": "ws", "idempotency-key": "copy-generation-key" }), json: async () => body }) as NextRequest;

describe("Simple Studio admitted copy boundary", () => {
  it("rejects incomplete input before provider work", async () => {
    const response = await POST(request({ prompt: "اكتب إعلاناً" }));
    expect(response.status).toBe(400);
  });

  it("uses the shared admission contract rather than a legacy provider path", async () => {
    const response = await POST(request({
      prompt: "اكتب إعلاناً خليجياً",
      model: { provider: "replicate", model: "meta/meta-llama-3-8b-instruct", version: "immutable-version", inputSchemaDigest: `sha256:${"a".repeat(64)}` },
      capability: "text_generation",
      contentLanguage: "ar",
      arabicVariety: "gulf",
      quantity: 1,
      sourceAssetIds: [],
      rightsBasis: "owned",
      permittedRemix: "reference_only",
      rightsEvidenceIds: [],
      remixBrief: { preserve: ["brand voice"], transform: ["short copy"], avoid: [] },
    }));
    await expect(response.json()).resolves.toMatchObject({ success: false, code: "MODEL_NOT_EXECUTABLE" });
    expect(response.status).toBe(422);
  });
});
