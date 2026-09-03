import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/studio/authz", () => ({ authorizeStudioRequest: vi.fn(async () => ({ authorized: true, workspaceId: "ws", userId: "u", role: "owner" })), authzErrorResponse: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => ({})), isDatabaseConfigured: () => true, schema: {} }));
import { POST } from "../route";

const request = (body: unknown, key = "generation-key") => ({ headers: new Headers({ "x-workspace-id": "ws", "idempotency-key": key }), json: async () => body }) as NextRequest;
const valid = { prompt: "حملة عربية", model: { provider: "replicate", model: "prunaai/p-video", version: "operator-version", inputSchemaDigest: `sha256:${"a".repeat(64)}` }, capability: "text_to_video", contentLanguage: "ar", arabicVariety: "gulf", quantity: 5, sourceAssetIds: [], rightsBasis: "owned", permittedRemix: "transform", remixBrief: { preserve: ["brand"], transform: ["motion"], avoid: [] } };

describe("admitted Simple Studio generation", () => {
  it("rejects incomplete rights/language/model input before provider work", async () => { const response = await POST(request({ prompt: "x" })); expect(response.status).toBe(400); });
  it("returns an actionable qualification precondition rather than the legacy 409 dead end", async () => { const response = await POST(request(valid)); const body = await response.json(); expect(response.status).toBe(422); expect(body).toMatchObject({ success: false, code: "MODEL_NOT_EXECUTABLE", nextActions: [{ code: "configure_model" }] }); });
});
