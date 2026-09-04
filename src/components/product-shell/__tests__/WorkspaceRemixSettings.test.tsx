import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { WorkspaceRemixSettings } from "../WorkspaceRemixSettings";

const summary = {
  themes: [
    { catalogId: "editorial-desert-dusk", themeId: "curated-theme:editorial-desert-dusk", revision: 1, authoredName: { en: "Editorial Focus · Desert Dusk", ar: "تركيز تحريري · غسق الصحراء" }, authoredDescription: { en: "Clear hierarchy.", ar: "تسلسل بصري واضح." }, culturalNote: { en: "Regional geometry without copied ornament.", ar: "هندسة إقليمية من دون نسخ الزخارف." }, palette: ["#4A2C2A", "#D88C6A"], digest: `sha256:${"a".repeat(64)}`, active: true },
    { catalogId: "kinetic-gulf-coast", themeId: "curated-theme:kinetic-gulf-coast", revision: 1, authoredName: { en: "Kinetic Type · Gulf Coast", ar: "حروف حركية · ساحل الخليج" }, authoredDescription: { en: "Readable motion type.", ar: "حروف حركية مقروءة." }, culturalNote: { en: "Arabic-ready.", ar: "جاهزة للعربية." }, palette: ["#073B4C", "#118AB2"], digest: `sha256:${"b".repeat(64)}`, active: false },
  ], activeThemeCount: 1, themeLimit: 50, mediaSets: [{ id: "set_1", title: "Products", revision: 3, assetCount: 4, purpose: "general" }], measuredAt: "2026-09-04T12:00:00Z",
};

describe("WorkspaceRemixSettings", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify(init?.method === "POST" ? { success: true, result: {} } : { success: true, data: summary }), { status: 200, headers: { "content-type": "application/json" } }))); });
  afterEach(() => vi.unstubAllGlobals());

  it("shows versioned themes and mutates catalog membership through the typed API", async () => {
    render(<I18nTestProvider locale="en"><WorkspaceRemixSettings workspaceId="workspace-1" canManage /></I18nTestProvider>);
    expect(await screen.findByRole("heading", { name: "Remix" })).toBeInTheDocument();
    expect(screen.getByText("1 of 50 active")).toBeInTheDocument();
    expect(screen.getByText("Products")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add theme" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/product-themes", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "add", catalogId: "kinetic-gulf-coast" }) })));
    expect(screen.getByRole("link", { name: "Manage in Library" })).toHaveAttribute("href", "/library?tab=media");
  });

  it("uses authored Arabic catalog content and RTL layout", async () => {
    const { container } = render(<I18nTestProvider locale="ar"><WorkspaceRemixSettings workspaceId="workspace-1" canManage={false} /></I18nTestProvider>);
    expect(await screen.findByRole("heading", { name: "إعادة المزج" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
    expect(container.firstElementChild).toHaveAttribute("lang", "ar");
    expect(screen.getByText("تركيز تحريري · غسق الصحراء")).toBeInTheDocument();
    expect(screen.getByTitle(summary.themes[0].digest).querySelector("bdi")).toHaveAttribute("dir", "ltr");
    expect(screen.getByText(/ليست نسخًا من سمات Fastlane/)).toBeInTheDocument();
  });
});
