import { describe, expect, it } from "vitest";
import {
  getSiteRedirect,
  isProductPath,
  normalizeOrigin,
} from "@/lib/site-routing";

const origins = {
  marketingOrigin: "https://tasmeemai.test",
  appOrigin: "https://app.tasmeemai.test",
};

describe("site routing", () => {
  it("normalizes configured origins", () => {
    expect(normalizeOrigin(" https://app.tasmeemai.test/ ")).toBe(
      "https://app.tasmeemai.test",
    );
    expect(normalizeOrigin("not a url")).toBeNull();
    expect(normalizeOrigin(undefined)).toBeNull();
  });

  it.each([
    "/sign-in",
    "/sign-up",
    "/verify-email",
    "/onboarding",
    "/blitz",
    "/simple-studio/images",
    "/social/calendar",
    "/editor/projects",
    "/studio/usage",
    "/agents",
    "/dashboard",
    "/ai-studio",
    "/automations",
    "/billing",
    "/brand",
    "/content",
    "/library",
    "/calendar",
    "/analytics",
    "/settings",
    "/compose",
    "/channels",
    "/approvals",
    "/deliveries",
    "/influencers",
    "/inspiration",
    "/r/REFCODE",
    "/refer-and-earn",
  ])("recognizes %s as product UI", (pathname) => {
    expect(isProductPath(pathname)).toBe(true);
  });

  it("does not classify APIs or static files as product UI", () => {
    expect(isProductPath("/api/generate")).toBe(false);
    expect(isProductPath("/logo-node.svg")).toBe(false);
  });

  it("moves product UI from the marketing origin to the app origin", () => {
    expect(
      getSiteRedirect({
        requestUrl:
          "https://tasmeemai.test/social/calendar?view=week#scheduled",
        hostname: "tasmeemai.test",
        ...origins,
      }),
    ).toBe("https://app.tasmeemai.test/social/calendar?view=week#scheduled");
  });

  it("treats www as an alias of the configured marketing apex", () => {
    expect(
      getSiteRedirect({
        requestUrl: "https://www.tasmeemai.test/sign-in",
        hostname: "www.tasmeemai.test",
        ...origins,
      }),
    ).toBe("https://app.tasmeemai.test/sign-in");
  });

  it("sends the app root to the default product home", () => {
    expect(
      getSiteRedirect({
        requestUrl: "https://app.tasmeemai.test/",
        hostname: "app.tasmeemai.test",
        ...origins,
      }),
    ).toBe("https://app.tasmeemai.test/onboarding");
  });

  it("leaves marketing, product, and shared API requests on their proper origins", () => {
    expect(
      getSiteRedirect({
        requestUrl: "https://tasmeemai.test/",
        hostname: "tasmeemai.test",
        ...origins,
      }),
    ).toBeNull();
    expect(
      getSiteRedirect({
        requestUrl: "https://app.tasmeemai.test/social/calendar",
        hostname: "app.tasmeemai.test",
        ...origins,
      }),
    ).toBeNull();
    expect(
      getSiteRedirect({
        requestUrl: "https://tasmeemai.test/api/social/webhooks/provider",
        hostname: "tasmeemai.test",
        ...origins,
      }),
    ).toBeNull();
  });

  it("keeps bare localhost in single-origin development mode", () => {
    expect(
      getSiteRedirect({
        requestUrl: "http://localhost:3000/",
        hostname: "localhost",
        marketingOrigin: "http://localhost:3000",
        appOrigin: "http://localhost:3000",
      }),
    ).toBeNull();
    expect(
      getSiteRedirect({
        requestUrl: "http://localhost:3000/social/calendar",
        hostname: "localhost",
        marketingOrigin: "http://localhost:3000",
        appOrigin: "http://localhost:3000",
      }),
    ).toBeNull();
  });

  it("supports explicit subdomains during local development", () => {
    expect(
      getSiteRedirect({
        requestUrl: "http://app.localhost:3000/",
        hostname: "app.localhost",
        marketingOrigin: "http://www.localhost:3000",
        appOrigin: "http://app.localhost:3000",
      }),
    ).toBe("http://app.localhost:3000/onboarding");
    expect(
      getSiteRedirect({
        requestUrl: "http://www.localhost:3000/sign-in?next=%2Fsocial",
        hostname: "www.localhost",
        marketingOrigin: "http://www.localhost:3000",
        appOrigin: "http://app.localhost:3000",
      }),
    ).toBe("http://app.localhost:3000/sign-in?next=%2Fsocial");
  });

  it("does not redirect unknown preview hosts", () => {
    expect(
      getSiteRedirect({
        requestUrl: "https://preview-abc.vercel.app/social/calendar",
        hostname: "preview-abc.vercel.app",
        ...origins,
      }),
    ).toBeNull();
  });
});
