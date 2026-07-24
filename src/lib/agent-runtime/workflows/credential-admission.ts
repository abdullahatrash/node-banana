import type { WorkflowCredentialMetadataReader } from "@/types/credentials";
import type { WorkflowCredentialSlotAdmissionPort } from "./types";

/**
 * Publication-time, secret-free Credential Slot admission. Current effective
 * authorization is supplied only by the dispatcher admission; callers cannot
 * name or widen Credential Profile authority in Workflow input.
 */
export class CredentialVaultWorkflowSlotAdmission
  implements WorkflowCredentialSlotAdmissionPort
{
  constructor(private readonly credentials: WorkflowCredentialMetadataReader) {}

  async isAccessible(
    input: Parameters<WorkflowCredentialSlotAdmissionPort["isAccessible"]>[0],
  ): Promise<boolean> {
    const slot = await this.credentials.getSafeWorkflowSlot({
      workspaceId: input.workspaceId,
      slotId: input.slotId,
      provider: input.provider,
    });
    return Boolean(
      slot &&
        (input.effectiveResources.credentialProfileIds ?? []).includes(
          slot.profileId,
        ),
    );
  }
}
