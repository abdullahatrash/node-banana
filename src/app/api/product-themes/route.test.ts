import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const authorize = vi.fn();
const summary = vi.fn();
const add = vi.fn();
const archive = vi.fn();
const { CatalogError } = vi.hoisted(() => ({ CatalogError: class ContentThemeCatalogError extends Error { constructor(readonly code: string) { super(code); } } }));

vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/studio/authz", () => ({ authorizeStudioRequest: (...args: unknown[]) => authorize(...args), authzErrorResponse: (result: { status: number; error: string }) => NextResponse.json({ success: false, error: result.error }, { status: result.status }) }));
vi.mock("@/lib/product-surfaces/content-theme-catalog-repository", () => ({ ContentThemeCatalogError: CatalogError, getWorkspaceRemixSummary: (...args: unknown[]) => summary(...args), addCuratedContentTheme: (...args: unknown[]) => add(...args), archiveCuratedContentTheme: (...args: unknown[]) => archive(...args) }));

import { GET, POST } from "./route";

describe("/api/product-themes", () => {
  beforeEach(() => { vi.clearAllMocks(); authorize.mockResolvedValue({ authorized: true, userId: "user-1", workspaceId: "workspace-1", role: "member" }); });

  it("returns the authorized Workspace catalog with private caching", async () => {
    summary.mockResolvedValue({ themes: [], activeThemeCount: 0, themeLimit: 50, mediaSets: [], measuredAt: "2026-09-04T12:00:00Z" });
    const response = await GET(new NextRequest("http://localhost/api/product-themes"), undefined);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(summary).toHaveBeenCalledWith("workspace-1");
  });

  it("adds and archives only typed catalog identifiers", async () => {
    add.mockResolvedValue({ kind: "created" }); archive.mockResolvedValue({ id: "theme" });
    const addResponse = await POST(new NextRequest("http://localhost/api/product-themes", { method: "POST", body: JSON.stringify({ action: "add", catalogId: "editorial-desert-dusk" }) }), undefined);
    expect(addResponse.status).toBe(200);
    expect(add).toHaveBeenCalledWith({ workspaceId: "workspace-1", userId: "user-1", catalogId: "editorial-desert-dusk" });
    const archiveResponse = await POST(new NextRequest("http://localhost/api/product-themes", { method: "POST", body: JSON.stringify({ action: "archive", catalogId: "editorial-desert-dusk" }) }), undefined);
    expect(archiveResponse.status).toBe(200);
    expect(archive).toHaveBeenCalledWith({ workspaceId: "workspace-1", catalogId: "editorial-desert-dusk" });
  });

  it("surfaces catalog limits without mutating another resource", async () => {
    add.mockRejectedValue(new CatalogError("CONTENT_THEME_LIMIT_REACHED"));
    const response = await POST(new NextRequest("http://localhost/api/product-themes", { method: "POST", body: JSON.stringify({ action: "add", catalogId: "editorial-desert-dusk" }) }), undefined);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CONTENT_THEME_LIMIT_REACHED" });
  });
});
