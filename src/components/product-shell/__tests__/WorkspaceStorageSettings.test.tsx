import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { WorkspaceStorageSettings } from "../WorkspaceStorageSettings";

const storageSummary = {
  quotaBytes: 10 * 1024 ** 3,
  usedBytes: 5 * 1024 ** 3,
  pendingReservedBytes: 1 * 1024 ** 3,
  activeAssetCount: 12,
  recoverableDeletedBytes: 512 * 1024 ** 2,
  recoverableDeletedCount: 2,
  byType: [
    { type: "image" as const, bytes: 2 * 1024 ** 3, count: 8 },
    { type: "video" as const, bytes: 3 * 1024 ** 3, count: 4 },
  ],
  measuredAt: "2026-09-04T12:00:00.000Z",
};

describe("WorkspaceStorageSettings", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: storageSummary,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("loads the authorized workspace projection and exposes safe cleanup paths", async () => {
    render(
      <I18nTestProvider locale="en">
        <WorkspaceStorageSettings workspaceId="workspace-1" />
      </I18nTestProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Workspace storage" })).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/studio/storage", {
      headers: { "x-workspace-id": "workspace-1" },
      cache: "no-store",
    }));
    expect(screen.getByRole("progressbar", { name: "Workspace storage usage" })).toHaveAttribute("aria-valuenow", "60");
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Images · 8 assets")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review Workspace Library" })).toHaveAttribute("href", "/library");
    expect(screen.getByRole("link", { name: "Review plans" })).toHaveAttribute("href", "/billing");
  });

  it("renders authored Arabic labels and RTL direction", async () => {
    const { container } = render(
      <I18nTestProvider locale="ar">
        <WorkspaceStorageSettings workspaceId="workspace-1" />
      </I18nTestProvider>,
    );

    expect(await screen.findByRole("heading", { name: "تخزين مساحة العمل" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
    expect(screen.getAllByText(/غيغابايت/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "مراجعة مكتبة مساحة العمل" })).toHaveAttribute("href", "/library");
  });
});
