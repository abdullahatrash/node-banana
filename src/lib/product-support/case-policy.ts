import { z } from "zod"
import type { WorkspaceRole } from "@/lib/db/schema"

export const supportCaseStateSchema = z.enum(["open", "waiting_customer", "investigating", "resolved", "closed"])
export type SupportCaseState = z.infer<typeof supportCaseStateSchema>

const TRANSITIONS: Record<SupportCaseState, readonly SupportCaseState[]> = {
  open: ["waiting_customer", "investigating", "resolved"],
  waiting_customer: ["investigating", "resolved"],
  investigating: ["waiting_customer", "resolved"],
  resolved: ["investigating", "closed"],
  closed: [],
}

export class SupportCasePolicyError extends Error {
  constructor(readonly code: "SUPPORT_CASE_ADMIN_REQUIRED" | "SUPPORT_CASE_TRANSITION_INVALID" | "SUPPORT_CASE_RESOLUTION_REQUIRED") { super(code) }
}

export function admitSupportCaseTransition(input: { actorRole: WorkspaceRole; from: string; to: string; resolution: string }) {
  if (input.actorRole !== "owner" && input.actorRole !== "admin") throw new SupportCasePolicyError("SUPPORT_CASE_ADMIN_REQUIRED")
  const from = supportCaseStateSchema.safeParse(input.from)
  const to = supportCaseStateSchema.safeParse(input.to)
  if (!from.success || !to.success || !TRANSITIONS[from.data].includes(to.data)) throw new SupportCasePolicyError("SUPPORT_CASE_TRANSITION_INVALID")
  const resolution = input.resolution.trim()
  if ((to.data === "resolved" || to.data === "closed") && !resolution) throw new SupportCasePolicyError("SUPPORT_CASE_RESOLUTION_REQUIRED")
  return { state: to.data, resolution }
}
