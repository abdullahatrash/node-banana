import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/renderWithIntl";
import { BudgetCockpit } from "./BudgetCockpit";

function resultFor(capability: string) {
  if (capability === "budget_policies.list@1") {
    return {
      schema: "budget-policy-list/v1",
      items: [{
        policy: {
          id: "policy_1",
          scope: "workspace",
          currency: "USD",
          period: "calendar_month",
          timezone: "UTC",
        },
        revision: { warningThreshold: "80", hardLimit: "100" },
      }],
    };
  }
  if (capability === "pricing_overrides.list@1") {
    return {
      schema: "workspace-pricing-override-list/v1",
      items: [{
        id: "pricing_1",
        provider: "replicate",
        model: "vendor/model",
        dimension: "replicate.predict_seconds@1",
        unit: "millisecond",
        price: "0.001",
        currency: "USD",
        perQuantity: "1",
        runCeiling: "5",
        status: "active",
      }],
    };
  }
  if (capability === "spend_controls.get@1") {
    return {
      schema: "workspace-spend-control/v1",
      workspaceId: "workspace_1",
      suspended: false,
    };
  }
  return {};
}

describe("BudgetCockpit", () => {
  beforeEach(() => {
    window.localStorage.setItem(
      "node-banana-active-workspace-id",
      "workspace_1",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          capability: string;
        };
        return new Response(
          JSON.stringify({
            success: true,
            capability: request.capability,
            result: resultFor(request.capability),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
  });

  it("renders policy, pricing, and emergency-control state from canonical capabilities", async () => {
    render(<BudgetCockpit />);
    expect(await screen.findByText("Provider spend active")).toBeInTheDocument();
    expect(screen.getByText("100 USD")).toBeInTheDocument();
    expect(screen.getByText("replicate · vendor/model")).toBeInTheDocument();
    expect(screen.getByText(/Reservations authorize bounded execution/)).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  });

  it("changes emergency spend only after collecting an audit reason", async () => {
    render(<BudgetCockpit />);
    await screen.findByText("Provider spend active");
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Record a reason",
    );

    fireEvent.change(screen.getByLabelText("Spend control reason"), {
      target: { value: "Provider incident" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls;
      expect(
        calls.some(([, init]) =>
          String(init?.body).includes("spend_controls.suspend@1") &&
          String(init?.body).includes("Provider incident"),
        ),
      ).toBe(true);
    });
  });
});
