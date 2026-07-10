import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockShowToast = vi.fn();
const mockListProviderKeysRequest = vi.fn();
const mockSaveProviderKeyRequest = vi.fn();
const mockDeleteProviderKeyRequest = vi.fn();

vi.mock("@/components/Toast", () => ({
  useToast: () => ({ show: mockShowToast }),
}));

vi.mock("@/lib/byok/client", () => ({
  listProviderKeysRequest: (...args: unknown[]) =>
    mockListProviderKeysRequest(...args),
  saveProviderKeyRequest: (...args: unknown[]) =>
    mockSaveProviderKeyRequest(...args),
  deleteProviderKeyRequest: (...args: unknown[]) =>
    mockDeleteProviderKeyRequest(...args),
}));

import { ProviderKeysSettings } from "@/components/social/ProviderKeysSettings";

describe("ProviderKeysSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListProviderKeysRequest.mockResolvedValue([]);
  });

  it("loads and displays stored provider keys with masked hints", async () => {
    mockListProviderKeysRequest.mockResolvedValue([
      {
        provider: "openai",
        hint: "sk-…test",
        lastValidatedAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
    ]);

    render(<ProviderKeysSettings />);

    expect(await screen.findByText("sk-…test")).toBeInTheDocument();
    // "OpenAI" also appears as a <select> option, so assert at least one match.
    expect(screen.getAllByText(/openai/i).length).toBeGreaterThan(0);
  });

  it("shows an empty state when no keys are stored", async () => {
    render(<ProviderKeysSettings />);

    expect(await screen.findByText(/no provider keys yet/i)).toBeInTheDocument();
  });

  it("saves a new key and shows a success toast", async () => {
    mockSaveProviderKeyRequest.mockResolvedValue({
      provider: "openai",
      hint: "sk-…new4",
      lastValidatedAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    });

    render(<ProviderKeysSettings />);
    await waitFor(() => expect(mockListProviderKeysRequest).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/provider/i), {
      target: { value: "openai" },
    });
    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: "sk-realsecretvalue1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save key/i }));

    await waitFor(() =>
      expect(mockSaveProviderKeyRequest).toHaveBeenCalledWith(
        "openai",
        "sk-realsecretvalue1234",
      ),
    );
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringMatching(/saved/i),
        "success",
      ),
    );
  });

  it("shows the provider's error toast when validation fails", async () => {
    mockSaveProviderKeyRequest.mockRejectedValue(
      new Error("Incorrect API key provided."),
    );

    render(<ProviderKeysSettings />);
    await waitFor(() => expect(mockListProviderKeysRequest).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: "sk-bad" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save key/i }));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        "Incorrect API key provided.",
        "error",
      ),
    );
  });

  it("deletes a key after confirmation", async () => {
    mockListProviderKeysRequest.mockResolvedValue([
      {
        provider: "openai",
        hint: "sk-…test",
        lastValidatedAt: null,
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
    ]);
    mockDeleteProviderKeyRequest.mockResolvedValue(undefined);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<ProviderKeysSettings />);
    const deleteButton = await screen.findByRole("button", { name: /delete/i });
    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(mockDeleteProviderKeyRequest).toHaveBeenCalledWith("openai"),
    );

    vi.unstubAllGlobals();
  });

  it("does not delete when the confirmation is declined", async () => {
    mockListProviderKeysRequest.mockResolvedValue([
      {
        provider: "openai",
        hint: "sk-…test",
        lastValidatedAt: null,
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
    ]);
    vi.stubGlobal("confirm", vi.fn(() => false));

    render(<ProviderKeysSettings />);
    const deleteButton = await screen.findByRole("button", { name: /delete/i });
    fireEvent.click(deleteButton);

    expect(mockDeleteProviderKeyRequest).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
