import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSimpleStudioStore, type Generation } from "@/store/simpleStudioStore";
import { LatestResultsInline } from "../LatestResultsInline";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, string>) => {
    if (namespace === "generationRecovery") return ({
      "errors.DURABLE_REPLICATE_CREDENTIAL_REQUIRED": "This workspace needs a validated Replicate key.",
      "errors.GENERATION_PENDING_RECOVERY": "The durable operation needs inspection.",
      "actions.configure_provider_key": "Add Replicate key",
      "actions.inspect_operations": "Inspect operations",
    } as Record<string, string>)[key] ?? key;
    if (key === "failed") return `Generation failed: ${values?.reason}`;
    return ({ latest: "Latest results", viewAll: "View all" } as Record<string, string>)[key] ?? key;
  },
}));

const failed: Generation = {
  id: "generation-1",
  batchId: "batch-1",
  status: "failed",
  result: null,
  assetId: null,
  error: "DURABLE_REPLICATE_CREDENTIAL_REQUIRED",
  nextActionCode: "configure_provider_key",
  nextActionHref: "/settings?section=providers",
  mode: "photo",
  aspectRatio: "9:16",
  prompt: "A product image",
  createdAt: 1,
  modelName: "Model",
};

describe("LatestResultsInline recovery actions", () => {
  beforeEach(() => {
    useSimpleStudioStore.setState({
      mode: "photo",
      generations: [failed],
      generationsByMode: { photo: [failed], video: [], copy: [] },
    });
  });

  it("renders an authored failure and the backend-approved recovery destination", () => {
    render(<LatestResultsInline mode="photo" />);

    expect(screen.getByRole("alert")).toHaveTextContent("This workspace needs a validated Replicate key.");
    expect(screen.getByRole("link", { name: "Add Replicate key" })).toHaveAttribute("href", "/settings?section=providers");
  });

  it("does not invent an action when the backend supplied none", () => {
    useSimpleStudioStore.setState({
      generations: [{ ...failed, nextActionCode: null, nextActionHref: null }],
      generationsByMode: { photo: [{ ...failed, nextActionCode: null, nextActionHref: null }], video: [], copy: [] },
    });
    render(<LatestResultsInline mode="photo" />);

    expect(screen.queryByRole("link", { name: "Add Replicate key" })).not.toBeInTheDocument();
  });

  it("distinguishes a recoverable pending operation from active generation", () => {
    const pending = { ...failed, status: "pending" as const, error: "GENERATION_PENDING_RECOVERY", nextActionCode: "inspect_operations", nextActionHref: "/studio/operations" };
    useSimpleStudioStore.setState({ generations: [pending], generationsByMode: { photo: [pending], video: [], copy: [] } });
    render(<LatestResultsInline mode="photo" />);

    expect(screen.getByRole("status")).toHaveTextContent("The durable operation needs inspection.");
    expect(screen.getByRole("link", { name: "Inspect operations" })).toHaveAttribute("href", "/studio/operations");
    expect(screen.queryByText("generating")).not.toBeInTheDocument();
  });
});
