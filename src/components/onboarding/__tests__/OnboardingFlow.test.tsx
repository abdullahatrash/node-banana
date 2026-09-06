import { fireEvent, render as testingRender, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedOnboardingSnapshot } from "@/lib/onboarding/schemas";
import { useDirectionStore } from "@/store/directionStore";
import { I18nTestProvider } from "@/test/i18n";
import type { ReactElement } from "react";

const replace = vi.fn();
const router = { replace, refresh: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <button type="button">language</button>,
}));

import { OnboardingFlow } from "../OnboardingFlow";

function render(ui: ReactElement) {
  const locale = useDirectionStore.getState().locale;
  return testingRender(<I18nTestProvider locale={locale}>{ui}</I18nTestProvider>);
}

function snapshot(
  currentStep: ParsedOnboardingSnapshot["currentStep"],
  revision = 0,
): ParsedOnboardingSnapshot {
  return {
    sessionId: "onb_1",
    userId: "user_1",
    workspaceId: currentStep === "identity" ? null : "ws_1",
    status: currentStep === "identity" ? "not_started" : "in_progress",
    currentStep,
    revision,
    interfaceLocale: "ar",
    contentLanguage: "ar",
    answers: {
      schemaVersion: 1,
      ...(currentStep === "identity"
        ? {}
        : {
            identity: {
              fullName: "نورة النجار",
              companyName: "تصميم",
              logoAssetId: null,
              interfaceLocale: "ar" as const,
              contentLanguage: "ar",
            },
          }),
      ...(currentStep === "company_stage"
        ? {
            brandSource: {
              kind: "description" as const,
              description: "منصة تساعد فرق المنطقة على صناعة محتوى عربي واضح.",
            },
            companyStage: {
              teamSize: "2_5" as const,
              monthlyRevenue: "1000_10000_usd" as const,
            },
          }
        : {}),
    },
    analysis: null,
    draftBrandProfileId: null,
    draftBrandProfile: null,
    activeBrandProfileId: null,
    activationArtifactId: null,
    activationArtifact: null,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OnboardingFlow", () => {
  beforeEach(() => {
    replace.mockReset();
    useDirectionStore.setState({ locale: "ar", direction: "rtl" });
    document.documentElement.dir = "rtl";
  });

  it("renders Arabic and submits locale and content language independently", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ success: true, snapshot: snapshot("identity") }))
      .mockResolvedValueOnce(json({ success: true, snapshot: snapshot("brand_source", 1) }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnboardingFlow />);
    expect(await screen.findByRole("heading", { name: "أخبرنا عن علامتك" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("الاسم الكامل"), { target: { value: "نورة النجار" } });
    fireEvent.change(screen.getByLabelText("اسم الشركة أو العلامة"), { target: { value: "تصميم" } });
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(request).toMatchObject({
      type: "save_identity",
      expectedRevision: 0,
      payload: { interfaceLocale: "ar", contentLanguage: "ar" },
    });
  });

  it("shows a saved dispatch failure and retries its existing run after reload", async () => {
    useDirectionStore.setState({ locale: "en", direction: "ltr" });
    const waiting = { ...snapshot("company_stage", 2), analysis: { runId: "run_1", stage: "queued" as const, status: "queued" as const, errorCode: "WORKFLOW_DISPATCH_FAILED", retryOfRunId: null } };
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ success: true, snapshot: waiting }))
      .mockResolvedValueOnce(json({ success: true, snapshot: { ...waiting, revision: 3, analysis: { ...waiting.analysis, errorCode: null } } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OnboardingFlow />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry preparation" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ type: "retry_preparation", expectedRevision: 2, payload: { runId: "run_1" } });
    expect(screen.getByRole("heading", { name: "Tell us about your current stage" })).toBeInTheDocument();
  });

  it("reuses the command identity when a response is lost", async () => {
    useDirectionStore.setState({ locale: "en", direction: "ltr" });
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ success: true, snapshot: snapshot("company_stage", 2) }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json({ success: true, snapshot: snapshot("role", 3) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OnboardingFlow />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await screen.findByText("Failed to fetch");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][1].body).toBe(fetchMock.mock.calls[1][1].body);
  });

  it("renders English without changing the stored content language", async () => {
    useDirectionStore.setState({ locale: "en", direction: "ltr" });
    document.documentElement.dir = "ltr";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ success: true, snapshot: snapshot("identity") })),
    );

    render(<OnboardingFlow />);
    expect(await screen.findByRole("heading", { name: "Tell us about your brand" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "العربية" })).toHaveAttribute("aria-pressed", "true");
  });

  it("restores saved questionnaire selections from the server snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ success: true, snapshot: snapshot("company_stage", 2) })),
    );

    render(<OnboardingFlow />);
    expect(await screen.findByRole("heading", { name: "أخبرنا عن مرحلتك الحالية" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2–5" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "$1,000–$10k" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("persists back navigation through the onboarding command API", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ success: true, snapshot: snapshot("company_stage", 2) }))
      .mockResolvedValueOnce(json({ success: true, snapshot: snapshot("brand_source", 3) }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OnboardingFlow />);
    await screen.findByRole("heading", { name: "أخبرنا عن مرحلتك الحالية" });
    fireEvent.click(screen.getByRole("button", { name: "رجوع" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({
      type: "go_back",
      expectedRevision: 2,
      payload: {},
    });
  });

  it("routes an already completed onboarding session to the dashboard", async () => {
    const completed = snapshot("education", 9);
    completed.status = "completed";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ success: true, snapshot: completed })),
    );

    render(<OnboardingFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });
});
