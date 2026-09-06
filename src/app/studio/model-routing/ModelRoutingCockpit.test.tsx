import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { ModelRoutingCockpit } from "./ModelRoutingCockpit";

const readiness = {
  schema: "generation-readiness/v1",
  qualifiedModelCount: 0,
  qualifiedCapabilities: [],
  gates: {
    acceptedBrand: true,
    canonicalMediaStorage: true,
    processingRegion: false,
    byokCredential: false,
    managedCredential: false,
    managedCreditRate: false,
  },
};

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/studio/model-routing/catalog")) {
      return new Response(JSON.stringify({ success: true, snapshot: "2026-09", items: [], generationReadiness: readiness }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: true, items: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
}

describe("ModelRoutingCockpit readiness", () => {
  beforeEach(() => localStorage.setItem("node-banana-active-workspace-id", "workspace-1"));
  afterEach(() => vi.unstubAllGlobals());

  it("shows managed credits and optional BYOK as independent blocked paths", async () => {
    installFetch();
    render(<I18nTestProvider locale="en"><ModelRoutingCockpit /></I18nTestProvider>);

    expect(await screen.findByRole("heading", { name: "AI execution readiness" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Managed Generation Credits" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Workspace Replicate key (optional)" })).toBeInTheDocument();
    expect(screen.getByText("Credits may exist, but managed provider execution remains closed until every listed gate is complete.")).toBeInTheDocument();
    expect(screen.getByText("The Workspace can choose this path after every listed gate is complete; it is not required for managed credits.")).toBeInTheDocument();
    expect(screen.getByText("Enable the managed Replicate account")).toBeInTheDocument();
    expect(screen.getByText("Save a validated Replicate key")).toBeInTheDocument();
    expect(screen.getAllByText("Qualify a compatible Replicate model")).toHaveLength(2);
  });

  it("uses authored Arabic readiness copy", async () => {
    installFetch();
    const { container } = render(<I18nTestProvider locale="ar"><ModelRoutingCockpit /></I18nTestProvider>);

    expect(await screen.findByRole("heading", { name: "جاهزية تنفيذ الذكاء الاصطناعي" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "أرصدة التوليد المُدار" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "مفتاح Replicate لمساحة العمل (اختياري)" })).toBeInTheDocument();
    expect(container).toHaveTextContent("وهو غير مطلوب لاستخدام الأرصدة المُدارة");
  });
});
