import { parseWorkflowCredentialSlots } from "@/types";

export class InvalidWorkflowCredentialSlotsError extends Error {}

/**
 * Server-side persistence guard. Every binding must use the exact persisted
 * shape; malformed, unknown, duplicate, missing-node, or provider-incompatible
 * declarations reject the write instead of persisting an ambiguous binding.
 */
export function sanitizeWorkflowCredentialSlots(
  workflow: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!workflow || workflow.credentialSlots === undefined) return workflow;
  const raw = workflow.credentialSlots;
  const parsed = parseWorkflowCredentialSlots(raw, workflow.nodes);
  if (!Array.isArray(raw) || parsed.length !== raw.length) {
    throw new InvalidWorkflowCredentialSlotsError(
      "Workflow Credential Slot bindings are invalid.",
    );
  }
  return { ...workflow, credentialSlots: parsed };
}
