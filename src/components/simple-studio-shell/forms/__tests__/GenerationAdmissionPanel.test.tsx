import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationAdmissionPanel } from "../GenerationAdmissionPanel";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string, values?: Record<string, string | number>) => namespace === "generationFunding" ? ({
    "byok.title": "Your Replicate key (BYOK)",
    "byok.description": "Replicate bills your provider account directly; Node Banana generation credits are not debited.",
    "byok.action": "Manage key",
    "managed.title": "Node Banana managed credits",
    "managed.description": "An exact credit debit must be approved before provider work starts.",
    "managed.action": "View credits",
    "selectModel": "Select an admitted model.",
    "unitPrice": `Provider price: ${values?.amount ?? ""} per ${values?.basis ?? ""}`,
    "estimatedCost": `Estimated provider cost for this request: ${values?.amount ?? ""}`,
    "basis.image": "image",
    "basis.second": "second",
    "basis.run": "run",
  })[key] ?? key : ({
    "managedQuote.title": "Confirm managed generation credits",
    "managedQuote.description": "Review the exact quote.",
    "managedQuote.creditDebit": "Maximum credit debit",
    "managedQuote.subtotal": "Subtotal",
    "managedQuote.tax": "Tax",
    "managedQuote.total": "Total",
    "managedQuote.expires": "Expires",
    "managedQuote.binding": `Bound to ${values?.id ?? ""}`,
    "managedQuote.decline": "Decline",
    "managedQuote.accept": "Accept quote and continue",
  })[key] ?? key,
}));

const quote = {
  schema: "managed-generation-credit-quote/v1" as const,
  quoteId: "52aa926b-60b2-4f42-8e49-1d40e783cc79",
  intentId: "intent-bound-to-request",
  totalDebitUnits: 14,
  currency: "USD" as const,
  subtotalMinor: 40,
  taxMinor: 0,
  totalMinor: 40,
  expiresAt: "2026-09-07T12:00:00.000Z",
  pricingSnapshotDigest: `sha256:${"a".repeat(64)}` as const,
  confirmationDigest: `sha256:${"b".repeat(64)}` as const,
};

describe("GenerationAdmissionPanel managed credit confirmation", () => {
  beforeEach(() => useSimpleStudioStore.setState({ fundingMode: "byok", pendingManagedCreditQuotes: [], selectedModelExecutionPriceUsd: null }));

  it("explains BYOK billing and previews the selected provider cost", () => {
    useSimpleStudioStore.setState({
      fundingMode: "byok",
      selectedModelExecutionPriceUsd: { basis: "second", amount: 0.02 },
    });
    render(<GenerationAdmissionPanel runs={2} quantityPerRun={5} />);
    expect(screen.getByTestId("generation-funding-summary")).toHaveTextContent("Your Replicate key (BYOK)");
    expect(screen.getByTestId("generation-funding-summary")).toHaveTextContent("$0.20");
    expect(screen.getByRole("link", { name: "Manage key" })).toHaveAttribute("href", "/settings?section=credentials");
  });

  it("explains managed credits before the exact quote is created", () => {
    useSimpleStudioStore.setState({ fundingMode: "managed", selectedModelExecutionPriceUsd: null });
    render(<GenerationAdmissionPanel />);
    expect(screen.getByTestId("generation-funding-summary")).toHaveTextContent("Node Banana managed credits");
    expect(screen.getByRole("link", { name: "View credits" })).toHaveAttribute("href", "/billing");
  });

  it("shows the exact debit, money and binding and requires an explicit decision", async () => {
    const resolve = vi.fn();
    useSimpleStudioStore.setState({ pendingManagedCreditQuotes: [quote], resolveManagedCreditQuote: resolve });
    render(<GenerationAdmissionPanel />);
    expect(screen.getByRole("dialog", { name: "Confirm managed generation credits" })).toHaveTextContent("14");
    expect(screen.getByRole("dialog")).toHaveTextContent("$0.40");
    expect(screen.getByRole("dialog")).toHaveTextContent("intent-bound-to-request");
    await userEvent.click(screen.getByRole("button", { name: "Accept quote and continue" }));
    expect(resolve).toHaveBeenCalledWith(quote.quoteId, true);
  });
});
