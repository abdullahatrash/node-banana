import { describe, expect, it } from "vitest";
import {
  allNavigationItems,
  findNavigationItem,
  isNavigationItemActive,
  primaryNavigation,
} from "../app-navigation";
import { compatibilityRoutes } from "../compatibility-routes";

describe("app navigation registry", () => {
  it("exposes every committed primary destination exactly once", () => {
    expect(primaryNavigation.map((item) => item.key)).toEqual([
      "dashboard",
      "blitz",
      "inspiration",
      "automations",
      "aiStudio",
      "influencers",
      "content",
      "library",
      "calendar",
      "analytics",
      "billing",
      "brand",
      "settings",
    ]);
    expect(new Set(allNavigationItems.map((item) => item.href)).size).toBe(
      allNavigationItems.length,
    );
    expect(
      primaryNavigation
        .filter((item) => "availability" in item)
        .map((item) => item.key),
    ).toEqual([]);
  });

  it("keeps legacy deep links active under their canonical destination", () => {
    const library = primaryNavigation.find((item) => item.key === "library");
    expect(library).toBeDefined();
    expect(isNavigationItemActive("/simple-studio/library", library!)).toBe(true);
    expect(findNavigationItem("/social/compose/post-1")?.key).toBe("compose");
    expect(findNavigationItem("/studio/publishing-deliveries/delivery-1")?.key).toBe(
      "deliveries",
    );
    expect(findNavigationItem("/social/posts/post-1")?.key).toBe("posts");
    expect(findNavigationItem("/social/media/asset-1")?.key).toBe("socialMedia");
    expect(findNavigationItem("/social/integrations")).toBeNull();
  });

  it("maps canonical adapters only to live legacy capabilities", () => {
    expect(compatibilityRoutes).toEqual({
      "/ai-studio": "/simple-studio/images",
      "/automations": "/social/agents",
      "/library": "/simple-studio/library",
      "/calendar": "/social/calendar",
      "/analytics": "/social/analytics",
      "/compose": "/social/compose",
      "/channels": "/social/channels",
      "/approvals": "/studio/publishing-approvals",
      "/deliveries": "/studio/publishing-deliveries",
    });
  });
});
