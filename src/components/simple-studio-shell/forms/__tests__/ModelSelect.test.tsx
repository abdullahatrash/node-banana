import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { ModelSelect } from "../ModelSelect";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/studio/client", () => ({ getActiveWorkspaceId: () => "ws" }));

const qualification = { status: "qualified", version: "immutable-version", inputSchemaDigest: `sha256:${"a".repeat(64)}`, executionPriceUsd: { basis: "image", amount: 0.01 } };

describe("ModelSelect capability admission", () => {
  beforeEach(() => {
    useSimpleStudioStore.setState({ referenceImages: [], selectedModelId: "text-model", selectedModelProvider: "replicate", selectedModelName: "Text", selectedModelVersion: "immutable-version", selectedModelSchemaDigest: `sha256:${"a".repeat(64)}` });
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ success: true, items: [
      { model: "text-model", label: "Text", provider: "replicate", capabilities: ["text_to_image"], qualification },
      { model: "edit-model", label: "Edit", provider: "replicate", capabilities: ["image_to_image"], qualification },
    ] }) }) as unknown as typeof fetch;
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
});
