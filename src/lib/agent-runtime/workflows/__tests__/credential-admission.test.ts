import { describe, expect, it } from "vitest";
import type { WorkflowCredentialMetadataReader } from "@/types/credentials";
import { CredentialVaultWorkflowSlotAdmission } from "../credential-admission";

const resources = {
  channelIds: [],
  credentialProfileIds: ["profile_allowed"],
  workflowIds: [],
  automationIds: [],
  artifactIds: [],
};

describe("CredentialVaultWorkflowSlotAdmission", () => {
  it("admits only safe Workspace metadata inside effective authority", async () => {
    const reader: WorkflowCredentialMetadataReader = {
      getSafeWorkflowSlot: async (input) =>
        input.workspaceId === "workspace_1" &&
        input.slotId === "slot_1" &&
        input.provider === "gemini"
          ? {
              slotId: "slot_1",
              profileId: "profile_allowed",
              provider: "gemini",
            }
          : null,
    };
    const admission = new CredentialVaultWorkflowSlotAdmission(reader);
    await expect(
      admission.isAccessible({
        workspaceId: "workspace_1",
        principalId: "principal_1",
        slotId: "slot_1",
        provider: "gemini",
        effectiveResources: resources,
      }),
    ).resolves.toBe(true);
    await expect(
      admission.isAccessible({
        workspaceId: "workspace_2",
        principalId: "principal_1",
        slotId: "slot_1",
        provider: "gemini",
        effectiveResources: resources,
      }),
    ).resolves.toBe(false);
  });

  it("fails closed when the resolved profile is not in effective authority", async () => {
    const reader: WorkflowCredentialMetadataReader = {
      getSafeWorkflowSlot: async () => ({
        slotId: "slot_1",
        profileId: "profile_other",
        provider: "gemini",
      }),
    };
    const admission = new CredentialVaultWorkflowSlotAdmission(reader);
    await expect(
      admission.isAccessible({
        workspaceId: "workspace_1",
        principalId: "principal_1",
        slotId: "slot_1",
        provider: "gemini",
        effectiveResources: resources,
      }),
    ).resolves.toBe(false);
  });
});
