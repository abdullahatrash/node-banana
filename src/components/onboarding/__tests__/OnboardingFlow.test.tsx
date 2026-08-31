import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedOnboardingSnapshot } from "@/lib/onboarding/schemas";
import { useDirectionStore } from "@/store/directionStore";

const replace = vi.fn();
const router = { replace, refresh: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <button type="button">language</button>,
}));

import { OnboardingFlow } from "../OnboardingFlow";

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
});
