import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { WorkspaceDemoVideosSettings } from "../WorkspaceDemoVideosSettings";

const first = { id: "video_1", name: "الأول.mp4", mimeType: "video/mp4", sizeBytes: 1_048_576, durationSeconds: 12, width: 1080, height: 1920, createdAt: "2026-09-04T12:00:00.000Z", eligibilityIssue: null };
const second = { id: "video_2", name: "second.mov", mimeType: "video/quicktime", sizeBytes: 2_097_152, durationSeconds: 20, width: 1080, height: 1920, createdAt: "2026-09-04T12:00:00.000Z", eligibilityIssue: null };
const summary = { sets: [{ id: "set_1", title: "Demo Videos", revision: 2, purpose: "demo_videos", category: "demo_videos", description: "Approved", assetIds: ["video_1"], assets: [first], unavailableAssetIds: [] }], eligibleAssets: [first, second], measuredAt: "2026-09-04T12:00:00.000Z" };

describe("WorkspaceDemoVideosSettings", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify(init?.method === "PATCH" ? { success: true, record: { id: "set_1", revision: 3 } } : { success: true, data: summary }), { status: 200, headers: { "content-type": "application/json" } })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows trusted constraints and adds an existing Asset by revising the canonical set", async () => {
    render(<I18nTestProvider locale="en"><WorkspaceDemoVideosSettings workspaceId="workspace-1" canManage /></I18nTestProvider>);
    expect(await screen.findByRole("heading", { name: "Demo Videos" })).toBeInTheDocument();
    expect(screen.getByText("MP4 or MOV only")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /second\.mov/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/product-library/media-sets", expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"assetIds":["video_1","video_2"]') })));
    expect(screen.getByRole("link", { name: "Open Media Library" })).toHaveAttribute("href", "/library?tab=media");
  });

  it("renders authored Arabic policy and controls in RTL", async () => {
    const { container } = render(<I18nTestProvider locale="ar"><WorkspaceDemoVideosSettings workspaceId="workspace-1" canManage={false} /></I18nTestProvider>);
    expect(await screen.findByRole("heading", { name: "فيديوهات العرض" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
    expect(screen.getByText(/لا تحدد بيانات المتصفح/)).toBeInTheDocument();
    expect(screen.getByText(/صلاحيتي رفع الوسائط/)).toBeInTheDocument();
  });
});
