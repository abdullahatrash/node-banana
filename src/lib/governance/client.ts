"use client";

import { getActiveWorkspaceId } from "@/lib/studio/client";
import type { GovernanceCommand } from "./service";
import type { GovernanceSnapshot } from "./types";

export class GovernanceApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "GovernanceApiError";
  }
}

export async function invokeGovernanceCapability<T>(
  capability: string,
  input: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) throw new GovernanceApiError("WORKSPACE_REQUIRED", 400);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-workspace-id": workspaceId,
  };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const response = await fetch("/api/studio/governance/capabilities", {
    method: "POST",
    headers,
    body: JSON.stringify({ capability, input }),
  });
  const body = await response.json() as { success?: boolean; code?: string; result?: T };
  if (!response.ok || !body.success) throw new GovernanceApiError(body.code ?? "UNAVAILABLE", response.status);
  return body.result as T;
}

export function getGovernanceSnapshot(): Promise<GovernanceSnapshot> {
  return invokeGovernanceCapability("governance.snapshot.get@1", {});
}

const capabilityByCommand: Record<GovernanceCommand["type"], string> = {
  create_custom_role: "roles.manage@1",
  revise_custom_role: "roles.manage@1",
  assign_role: "members.manage@1",
  create_invitation: "members.invite@1",
  revoke_invitation: "members.invite@1",
  remove_member: "members.manage@1",
  transfer_ownership: "workspace.transfer_ownership@1",
  request_workspace_closure: "workspace.close@1",
  cancel_workspace_closure: "workspace.close@1",
  execute_workspace_closure: "workspace.close@1",
  create_portfolio: "portfolios.manage@1",
  assign_portfolio: "portfolios.manage@1",
  revoke_portfolio_assignment: "portfolios.manage@1",
  issue_review_guest: "reviews.create@1",
  revoke_review_guest: "reviews.create@1",
  publish_approval_policy: "approval_policies.manage@1",
  request_content_acceptance: "reviews.create@1",
  decide_content_acceptance: "reviews.decide_content@1",
  advance_content_acceptance: "approval_policies.manage@1",
  begin_step_up: "governance.view@1",
  verify_step_up: "governance.view@1",
  request_audit_export: "audit.export@1",
  set_region_policy: "regions.manage@1",
  publish_retention_policy: "retention.manage@1",
  create_retention_hold: "retention.manage@1",
  release_retention_hold: "retention.manage@1",
  record_deletion: "retention.manage@1",
  create_safety_decision: "safety.decide@1",
  appeal_safety_decision: "safety.appeal@1",
  resolve_safety_appeal: "safety.decide@1",
  preview_bulk: "bulk.preview@1",
  start_bulk: "bulk.execute@1",
  cancel_bulk: "bulk.execute@1",
  retry_bulk_item: "bulk.execute@1",
  preview_import: "imports.manage@1",
  execute_import: "imports.manage@1",
  request_workspace_export: "exports.manage@1",
};

export function executeGovernanceCommand<T>(command: GovernanceCommand): Promise<T> {
  return invokeGovernanceCapability(capabilityByCommand[command.type], { command }, crypto.randomUUID());
}
