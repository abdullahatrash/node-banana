import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLocaleFromCookies: vi.fn(),
  permanentRedirect: vi.fn(),
}));

vi.mock("@/lib/locale", () => ({
  getLocaleFromCookies: mocks.getLocaleFromCookies,
}));

vi.mock("next/navigation", () => ({
  permanentRedirect: mocks.permanentRedirect,
}));

import PricingPage from "./page";

describe("/pricing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["ar", "en"] as const)(
    "permanently redirects to the %s localized pricing page",
    async (locale) => {
      mocks.getLocaleFromCookies.mockResolvedValue({ locale, source: "cookie" });

      await PricingPage();

      expect(mocks.permanentRedirect).toHaveBeenCalledWith(`/${locale}/pricing`);
    },
  );
});
