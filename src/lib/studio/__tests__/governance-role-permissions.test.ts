import { describe, expect, it } from "vitest";
import { applicationCapabilityKey, BUILT_IN_ROLE_APPLICATION_CAPABILITIES } from "@/lib/governance/roles";
import { permissionsFromCapabilityKeys } from "../authz";

function permissions(role: keyof typeof BUILT_IN_ROLE_APPLICATION_CAPABILITIES) {
  return permissionsFromCapabilityKeys(new Set(BUILT_IN_ROLE_APPLICATION_CAPABILITIES[role].map(applicationCapabilityKey)));
}

describe("governed legacy product permissions", () => {
  it("keeps Viewer read-only across Studio and Social", () => {
    expect(permissions("viewer")).toEqual(expect.arrayContaining(["workspaces:read", "projects:read", "assets:read", "social:view"]));
    expect(permissions("viewer")).not.toEqual(expect.arrayContaining(["workspaces:write", "projects:write", "assets:write", "social:publish", "social:connect", "social:manage"]));
  });

  it("does not turn Creator submission access into channel administration", () => {
    expect(permissions("creator")).toContain("social:publish");
    expect(permissions("creator")).not.toContain("social:connect");
    expect(permissions("creator")).not.toContain("social:manage");
    expect(permissions("creator")).toEqual(expect.arrayContaining([
      "product:read",
      "product:content:write",
      "product:inspiration:write",
      "product:campaigns:write",
      "product:analytics:write",
      "product:support:submit",
    ]));
  });

  it("keeps product viewers read-only while allowing them to contact support", () => {
    expect(permissions("viewer")).toContain("product:read");
    expect(permissions("viewer")).not.toContain("product:content:write");
    expect(permissions("viewer")).not.toContain("product:support:submit");
  });

  it("maps a Custom Role's exact capability set without a legacy member fallback", () => {
    const exactViewer = new Set([
      applicationCapabilityKey({ name: "studio.workspaces.read", version: 1 }),
      applicationCapabilityKey({ name: "social.content.read", version: 1 }),
    ]);
    expect(permissionsFromCapabilityKeys(exactViewer)).toEqual(["workspaces:read", "social:view"]);
  });
});
