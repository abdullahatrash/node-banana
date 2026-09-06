import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const authorize = vi.fn();
const listRecords = vi.fn();
const createSet = vi.fn();
const updateSet = vi.fn();
const selectAssets = vi.fn();
const { Conflict } = vi.hoisted(() => ({ Conflict: class ProductRecordConflictError extends Error {} }));

vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true, getDb: () => ({ select: () => ({ from: () => ({ where: () => selectAssets() }) }) }) }));
vi.mock("@/lib/studio/authz", () => ({ authorizeStudioRequest: (...args: unknown[]) => authorize(...args), authzErrorResponse: (result: { status: number; error: string }) => NextResponse.json({ success: false, error: result.error }, { status: result.status }) }));
vi.mock("@/lib/product-surfaces/domain-commands", () => ({ createMediaSetCommand: (...args: unknown[]) => createSet(...args), updateMediaSetCommand: (...args: unknown[]) => updateSet(...args) }));
vi.mock("@/lib/product-surfaces/repository", () => ({ ProductRecordConflictError: Conflict, listProductRecords: (...args: unknown[]) => listRecords(...args) }));

import { GET, PATCH, POST } from "./route";

const request = (method: string, body?: unknown, suffix = "") => new NextRequest(`http://localhost/api/product-library/media-sets${suffix}`, { method, body: body ? JSON.stringify(body) : undefined, headers: body ? { "content-type": "application/json" } : undefined });
const validAsset = { id: "video_1", workspaceId: "workspace-1", projectId: null, type: "video", storageProvider: "s3", storageBucket: "bucket", storageKey: "workspace/video.mp4", mimeType: "video/mp4", sizeBytes: 1024, width: 1080, height: 1920, durationSeconds: 12, checksum: `sha256:${"a".repeat(64)}`, metadata: { uploadState: "ready", originalFileName: "demo.mp4" }, createdByUserId: "user-1", createdAt: new Date("2026-09-04T12:00:00Z"), updatedAt: new Date("2026-09-04T12:00:00Z"), deletedAt: null };

describe("/api/product-library/media-sets", () => {
  beforeEach(() => { vi.clearAllMocks(); authorize.mockResolvedValue({ authorized: true, userId: "user-1", workspaceId: "workspace-1", role: "member" }); });

  it("returns ordered, eligible Demo Video membership from the authorized Workspace", async () => {
    listRecords.mockResolvedValue([{ id: "set_1", title: "Demos", revision: 3, kind: "media_set", state: "active", payload: { purpose: "demo_videos", category: "demo_videos", description: "Approved", assetIds: ["video_1"] } }]);
    selectAssets.mockResolvedValue([validAsset, { ...validAsset, id: "too_long", durationSeconds: 31 }]);
    const response = await GET(request("GET", undefined, "?purpose=demo_videos"), undefined);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.data.sets[0]).toMatchObject({ id: "set_1", revision: 3, assetIds: ["video_1"], assets: [{ id: "video_1", name: "demo.mp4" }] });
    expect(body.data.eligibleAssets.map((asset: { id: string }) => asset.id)).toEqual(["video_1"]);
  });

  it("passes immutable Demo Video semantics into creation", async () => {
    createSet.mockResolvedValue({ id: "set_1", revision: 1 });
    const body = { title: "Demos", assetIds: ["video_1"], category: "demo_videos", description: "Approved", purpose: "demo_videos", idempotencyKey: "request-123" };
    expect((await POST(request("POST", body), undefined)).status).toBe(200);
    expect(createSet).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-1", userId: "user-1", purpose: "demo_videos", assetIds: ["video_1"] }));
  });

  it("returns an explicit optimistic-concurrency conflict", async () => {
    updateSet.mockRejectedValue(new Conflict());
    const body = { id: "set_1", expectedRevision: 2, title: "Demos", assetIds: [], category: "demo_videos", description: "Approved", purpose: "demo_videos", idempotencyKey: "request-123" };
    const response = await PATCH(request("PATCH", body), undefined);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "MEDIA_SET_REVISION_CONFLICT" });
  });

  it("rejects unauthenticated reads before touching storage", async () => {
    authorize.mockResolvedValue({ authorized: false, status: 401, error: "Sign in", reason: "unauthenticated" });
    expect((await GET(request("GET", undefined, "?purpose=demo_videos"), undefined)).status).toBe(401);
    expect(listRecords).not.toHaveBeenCalled();
  });
});
