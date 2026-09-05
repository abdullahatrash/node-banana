import { beforeEach, describe, expect, it, vi } from "vitest";
import { render as testingRender, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/i18n/messages/en.json";
import arMessages from "@/i18n/messages/ar.json";

function render(ui: ReactElement, locale: "en" | "ar" = "en") {
  return testingRender(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "ar" ? arMessages : messages}
      timeZone="UTC"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

const mockShowToast = vi.fn();
const mockListProviderKeysRequest = vi.fn();
const mockSaveProviderKeyRequest = vi.fn();
const mockDeleteProviderKeyRequest = vi.fn();
const mockBeginProviderKeyStepUpRequest = vi.fn();
const mockVerifyProviderKeyStepUpRequest = vi.fn();

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
  beginProviderKeyStepUpRequest: (...args: unknown[]) =>
    mockBeginProviderKeyStepUpRequest(...args),
  verifyProviderKeyStepUpRequest: (...args: unknown[]) =>
    mockVerifyProviderKeyStepUpRequest(...args),
}));

import { ProviderKeysSettings } from "@/components/social/ProviderKeysSettings";

describe("ProviderKeysSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListProviderKeysRequest.mockResolvedValue([]);
    mockBeginProviderKeyStepUpRequest.mockResolvedValue({
      challengeId: "stepup_challenge_1",
      expiresAt: "2026-07-10T00:10:00.000Z",
    });
    mockVerifyProviderKeyStepUpRequest.mockResolvedValue({
      verified: true,
      stepUpToken: "step_up_token_1",
      expiresAt: "2026-07-10T00:10:00.000Z",
    });
  });

  async function completeStepUp() {
    fireEvent.click(screen.getByRole("button", { name: /send verification code/i }));
    await waitFor(() =>
      expect(mockBeginProviderKeyStepUpRequest).toHaveBeenCalled(),
    );
    fireEvent.change(screen.getByLabelText(/six-digit verification code/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify code/i }));
    await screen.findByRole("status");
  }

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

  it("exposes the secure confirmation controls with Arabic accessible names", async () => {
    render(<ProviderKeysSettings />, "ar");

    expect(await screen.findByLabelText("المزود")).toBeInTheDocument();
    expect(screen.getByText(/لتشفير بيانات الاعتماد المحفوظة فقط/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "إرسال رمز التحقق" }),
    ).toBeInTheDocument();
  });

  it("distinguishes vault encryption, BYOK spend, and managed credits", async () => {
    render(<ProviderKeysSettings />);

    expect(await screen.findByText(/only encrypts saved credentials/i)).toBeInTheDocument();
    expect(screen.getByText(/provider charges that account directly/i)).toBeInTheDocument();
    expect(screen.getByText(/only after you accept an exact quote/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /inspect generation readiness/i })).toHaveAttribute("href", "/studio/model-routing");
    expect(screen.getByRole("link", { name: /view plans and credits/i })).toHaveAttribute("href", "/billing");
  });

  it("requires an exact-provider challenge, verifies it, and forwards the token when saving", async () => {
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
    expect(screen.getByRole("button", { name: /save key/i })).toBeDisabled();

    await completeStepUp();

    expect(mockBeginProviderKeyStepUpRequest).toHaveBeenCalledWith("openai");
    expect(mockVerifyProviderKeyStepUpRequest).toHaveBeenCalledWith(
      "stepup_challenge_1",
      "123456",
    );
    fireEvent.click(screen.getByRole("button", { name: /save key/i }));

    await waitFor(() =>
      expect(mockSaveProviderKeyRequest).toHaveBeenCalledWith(
        "openai",
        "sk-realsecretvalue1234",
        "step_up_token_1",
      ),
    );
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringMatching(/saved/i),
        "success",
      ),
    );
  });

  it("shows authored copy instead of a provider's raw validation error", async () => {
    mockSaveProviderKeyRequest.mockRejectedValue(
      new Error("Incorrect API key provided."),
    );

    render(<ProviderKeysSettings />);
    await waitFor(() => expect(mockListProviderKeysRequest).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: "sk-bad" },
    });
    await completeStepUp();
    fireEvent.click(screen.getByRole("button", { name: /save key/i }));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        "Failed to save provider key",
        "error",
        false,
        null,
      ),
    );
    expect(screen.getByRole("button", { name: /save key/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /send verification code/i }),
    ).toBeInTheDocument();
  });

  it("announces challenge request errors without attempting a save", async () => {
    mockBeginProviderKeyStepUpRequest.mockRejectedValue(new Error("offline"));

    render(<ProviderKeysSettings />);
    fireEvent.click(await screen.findByRole("button", { name: /send verification code/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not send a verification code/i,
    );
    expect(mockVerifyProviderKeyStepUpRequest).not.toHaveBeenCalled();
    expect(mockSaveProviderKeyRequest).not.toHaveBeenCalled();
  });

  it("announces rejected verification and keeps save disabled", async () => {
    mockVerifyProviderKeyStepUpRequest.mockResolvedValue({
      verified: false,
      attemptsRemaining: 2,
    });

    render(<ProviderKeysSettings />);
    fireEvent.change(await screen.findByLabelText(/api key/i), {
      target: { value: "sk-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send verification code/i }));
    fireEvent.change(await screen.findByLabelText(/six-digit verification code/i), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify code/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/2 attempts remain/i);
    expect(screen.getByRole("button", { name: /save key/i })).toBeDisabled();
    expect(mockSaveProviderKeyRequest).not.toHaveBeenCalled();
  });

  it("invalidates a verified token when the provider changes", async () => {
    render(<ProviderKeysSettings />);
    fireEvent.change(await screen.findByLabelText(/api key/i), {
      target: { value: "secret" },
    });
    await completeStepUp();
    expect(screen.getByRole("button", { name: /save key/i })).toBeEnabled();

    fireEvent.change(screen.getByLabelText(/provider/i), {
      target: { value: "anthropic" },
    });

    expect(screen.getByRole("button", { name: /save key/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /send verification code/i })).toBeInTheDocument();
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
