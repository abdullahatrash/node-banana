import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { ReleaseQualityCockpit } from "./ReleaseQualityCockpit";

vi.mock("@/lib/studio/client", () => ({ getActiveWorkspaceId: () => "workspace-1" }));

describe("ReleaseQualityCockpit", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("shows exact manifest parity-cell coverage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, snapshot: { records: [] }, readiness: { buildId: "build-1", releasable: false, parityClaimAllowed: false, parityMatrix: { requiredCells: 4, passingCells: 2 }, blockers: [{ code: "PARITY_CELL_MISSING", subject: "copy-error-rtl" }] } }), { status: 200 })));
    render(<I18nTestProvider locale="en"><ReleaseQualityCockpit /></I18nTestProvider>);
    expect(await screen.findByText("Parity matrix: 2 of 4 exact cells passed")).toBeInTheDocument();
    expect(screen.getByText("PARITY_CELL_MISSING")).toBeInTheDocument();
  });
});
