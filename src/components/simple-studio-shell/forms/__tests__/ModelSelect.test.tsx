import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { ModelSelect } from "../ModelSelect";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/studio/client", () => ({ getActiveWorkspaceId: () => "ws" }));

const qualification = { status: "qualified", version: "immutable-version", inputSchemaDigest: `sha256:${"a".repeat(64)}`, executionPriceUsd: { basis: "image", amount: 0.01 } };
const ready = {
  schema: "generation-readiness/v1",
  qualifiedModelCount: 3,
  qualifiedCapabilities: ["text_generation", "text_to_image", "image_to_image"],
  gates: {
    acceptedBrand: true,
    canonicalMediaStorage: true,
    processingRegion: true,
    byokCredential: true,
    managedCredential: true,
    managedCreditRate: true,
  },
};

describe("ModelSelect capability admission", () => {
  beforeEach(() => {
    useSimpleStudioStore.setState({ fundingMode: "byok", referenceImages: [], selectedModelId: "text-model", selectedModelProvider: "replicate", selectedModelName: "Text", selectedModelVersion: "immutable-version", selectedModelSchemaDigest: `sha256:${"a".repeat(64)}`, selectedModelExecutionPriceUsd: null });
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ success: true, generationReadiness: ready, items: [
      { model: "text-model", label: "Text", provider: "replicate", capabilities: ["text_to_image"], qualification },
      { model: "edit-model", label: "Edit", provider: "replicate", capabilities: ["image_to_image"], qualification },
      { model: "copy-model", label: "Copy", provider: "replicate", capabilities: ["text_generation"], qualification: { ...qualification, executionPriceUsd: { basis: "run", amount: 0.02 } } },
    ] }) }) as unknown as typeof fetch;
  });

  it("only exposes qualified text-generation models in Copy", async () => {
    render(<ModelSelect mode="copy" id="model" />);
    await waitFor(() => expect(screen.getByRole("option", { name: /Copy/ })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: /Text/ })).not.toBeInTheDocument();
    expect(useSimpleStudioStore.getState().selectedModelId).toBe("copy-model");
    expect(useSimpleStudioStore.getState().selectedModelExecutionPriceUsd).toEqual({ basis: "run", amount: 0.02 });
  });

  it("switches to an image-to-image-qualified model when references are present", async () => {
    useSimpleStudioStore.setState({ referenceImages: ["data:image/png;base64,AA=="] });
    render(<ModelSelect mode="photo" id="model" />);
    await waitFor(() => expect(screen.getByRole("option", { name: /Edit/ })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: /Text/ })).not.toBeInTheDocument();
    await waitFor(() => expect(useSimpleStudioStore.getState().selectedModelId).toBe("edit-model"));
  });

  it("switches back to a text-to-image-qualified model after references are removed", async () => {
    useSimpleStudioStore.setState({ selectedModelId: "edit-model", referenceImages: [] });
    render(<ModelSelect mode="photo" id="model" />);
    await waitFor(() => expect(useSimpleStudioStore.getState().selectedModelId).toBe("text-model"));
  });

  it("explains the exact BYOK workspace gates and links to real settings", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({
      success: true,
      items: [],
      generationReadiness: {
        ...ready,
        qualifiedModelCount: 0,
        qualifiedCapabilities: [],
        gates: { ...ready.gates, acceptedBrand: false, processingRegion: false, byokCredential: false },
      },
    }) }) as unknown as typeof fetch;

    render(<ModelSelect mode="photo" id="model" />);

    expect(await screen.findByRole("link", { name: "gates.qualifiedModel.action" })).toHaveAttribute("href", "/studio/model-routing");
    expect(screen.getByRole("link", { name: "gates.acceptedBrand.action" })).toHaveAttribute("href", "/brand");
    expect(screen.getByRole("link", { name: "gates.processingRegion.action" })).toHaveAttribute("href", "/settings?section=data");
    expect(screen.getByRole("link", { name: "gates.byokCredential.action" })).toHaveAttribute("href", "/settings?section=providers");
    expect(screen.queryByRole("link", { name: "gates.managedCredential.action" })).not.toBeInTheDocument();
  });

  it("shows managed credential and credit-rate gates instead of the BYOK key", async () => {
    useSimpleStudioStore.setState({ fundingMode: "managed" });
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({
      success: true,
      items: [{ model: "copy-model", label: "Copy", provider: "replicate", capabilities: ["text_generation"], qualification }],
      generationReadiness: {
        ...ready,
        gates: { ...ready.gates, byokCredential: false, managedCredential: false, managedCreditRate: false },
      },
    }) }) as unknown as typeof fetch;

    render(<ModelSelect mode="copy" id="model" />);

    expect(await screen.findByRole("link", { name: "gates.managedCredential.action" })).toHaveAttribute("href", "/billing");
    expect(screen.getByRole("link", { name: "gates.managedCreditRate.action" })).toHaveAttribute("href", "/billing");
    expect(screen.queryByRole("link", { name: "gates.byokCredential.action" })).not.toBeInTheDocument();
  });
});
