import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { MarketingHome } from "../MarketingHome";

vi.mock("next/navigation", () => ({
  usePathname: () => "/en",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

describe("MarketingHome pricing navigation", () => {
  it.each([
    ["en" as const, "Pricing", "/en/pricing"],
    ["ar" as const, "الأسعار", "/ar/pricing"],
  ])("links the %s home to its localized pricing page", (locale, label, href) => {
    render(
      <I18nTestProvider locale={locale}>
        <MarketingHome locale={locale} contentStudioUrl="/compose" signInUrl="/sign-in" signUpUrl="/sign-up" />
      </I18nTestProvider>,
    );
    expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
  });
});
