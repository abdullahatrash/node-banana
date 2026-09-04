import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/renderWithIntl";
import { UsageCockpit } from "./UsageCockpit";

describe("UsageCockpit", () => {
  beforeEach(() => {
    window.localStorage.setItem("node-banana-active-workspace-id", "workspace_1");
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { capability: string };
      const result = request.capability === "usage_summaries.get@1"
        ? {
            schema: "usage-summary/v1",
            quantityTotals: [{ dimension: "gemini.tokens.input@1", unit: "count", source: "unknown", quantity: null, unknownCount: 1 }],
            costSubtotals: [],
            unknownValuationCount: 1,
            complete: false,
          }
        : request.capability === "usage_records.list@1"
          ? { items: [{ id: "usage_1", dimension: "gemini.tokens.input@1", unit: "count", source: "unknown", quantity: null, directArtifactId: null, binding: { runId: "run_1" } }] }
          : request.capability === "cost_valuations.list@1"
            ? { items: [{ id: "valuation_1", basis: "unknown", pricingSource: "unknown", amount: null, currency: null, pricingSnapshotIds: [], supersedesCostValuationId: null }] }
            : { items: [{ id: "event_1", type: "usage.settled", occurredAt: "2026-08-01T00:00:00.000Z" }] };
      return new Response(JSON.stringify({ success: true, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));
  });

  it("renders unknown usage as unknown rather than zero cost", async () => {
    render(<UsageCockpit />);
    expect(await screen.findByText("Contains unknowns")).toBeInTheDocument();
    expect(screen.getByText("1 unknown valuations")).toBeInTheDocument();
    expect(screen.getByText((_, element) =>
      element?.tagName === "P"
      && element.textContent === "Run run_1 · unknown · Artifact —"
    )).toBeInTheDocument();
    expect(screen.getByText("Local workflow estimates are not billing evidence.", { exact: false })).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  });
});
