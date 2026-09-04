import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationAdmissionPanel } from "../GenerationAdmissionPanel";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => ({
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
  beforeEach(() => useSimpleStudioStore.setState({ pendingManagedCreditQuotes: [] }));

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
