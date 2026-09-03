"use client";

import { getActiveWorkspaceId } from "@/lib/studio/client";
import type { GovernanceCommand } from "./service";
import type { GovernanceSnapshot } from "./types";
import type { PublishingApprovalPresentation } from "@/lib/agent-runtime/publishing-approvals/types";

export class GovernanceApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "GovernanceApiError";
  }
}

const RETRYABLE_TRANSPORT_STATUSES = new Set([502, 503, 504]);

async function fetchWithStableRetry(
  request: () => Promise<Response>,
  maxAttempts = 2,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await request();
      if (!RETRYABLE_TRANSPORT_STATUSES.has(response.status) || attempt === maxAttempts) return response;
      lastError = new GovernanceApiError("UNAVAILABLE", response.status);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
    }
  }
  throw lastError;
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
  const bodyJson = JSON.stringify({ capability, input });
  const response = await fetchWithStableRetry(() => fetch("/api/studio/governance/capabilities", {
    method: "POST",
    headers,
    body: bodyJson,
  }));
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
  provide_import_mapping: "imports.manage@1",
  request_workspace_export: "exports.manage@1",
};

export function executeGovernanceCommand<T>(command: GovernanceCommand): Promise<T> {
  // One key belongs to one logical submission and remains stable across the
  // bounded transport retry inside invokeGovernanceCapability.
  const idempotencyKey = crypto.randomUUID();
  return invokeGovernanceCapability(capabilityByCommand[command.type], { command }, idempotencyKey);
}

export async function downloadGovernanceExport(exportId: string): Promise<void> {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) throw new GovernanceApiError("WORKSPACE_REQUIRED", 400);
  const response = await fetch(`/api/studio/governance/exports/${encodeURIComponent(exportId)}/download`, {
    headers: { "x-workspace-id": workspaceId },
    cache: "no-store",
  });
  const body = await response.json() as { success?: boolean; code?: string; downloadUrl?: string };
  if (!response.ok || !body.success || !body.downloadUrl) throw new GovernanceApiError(body.code ?? "UNAVAILABLE", response.status);
  window.location.assign(body.downloadUrl);
}

export interface PublishingApprovalListItem {
  id: string;
  status: "pending" | "approved" | "denied" | "expired" | "consumed";
  planId: string;
  planRevisionId: string;
  planRevision: number;
  planRevisionDigest: string;
  inspectionDigest: string;
  createdAt: string;
  expiresAt: string;
}

async function publishingResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as { success?: boolean; code?: string; error?: string } & T;
  if (!response.ok || !body.success) {
    throw new GovernanceApiError(body.code ?? "UNAVAILABLE", response.status);
  }
  return body;
}

export async function listPublishingApprovals(
  status?: PublishingApprovalListItem["status"],
): Promise<PublishingApprovalListItem[]> {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) throw new GovernanceApiError("WORKSPACE_REQUIRED", 400);
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const response = await fetch(`/api/studio/publishing-approvals${query}`, {
    headers: { "x-workspace-id": workspaceId },
    cache: "no-store",
  });
  const body = await publishingResponse<{ items: PublishingApprovalListItem[] }>(response);
  return body.items;
}

export async function inspectPublishingApproval(
  approvalRequestId: string,
): Promise<PublishingApprovalPresentation> {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) throw new GovernanceApiError("WORKSPACE_REQUIRED", 400);
  const response = await fetch(`/api/studio/publishing-approvals/${encodeURIComponent(approvalRequestId)}`, {
    headers: { "x-workspace-id": workspaceId },
    cache: "no-store",
  });
  const body = await publishingResponse<{ presentation: PublishingApprovalPresentation }>(response);
  return body.presentation;
}

export async function decidePublishingApproval(input: {
  approvalRequestId: string;
  expectedInspectionDigest: string;
  decision: "approved" | "denied";
}): Promise<unknown> {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) throw new GovernanceApiError("WORKSPACE_REQUIRED", 400);
  const response = await fetch(`/api/studio/publishing-approvals/${encodeURIComponent(input.approvalRequestId)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-id": workspaceId,
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      decision: input.decision,
      expectedInspectionDigest: input.expectedInspectionDigest,
    }),
  });
  return publishingResponse(response);
}

export interface PublishingAuthorityGrant {
  id: string;
  userId: string;
  channelId: string;
  action: "publish";
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export async function listPublishingAuthorityGrants(): Promise<PublishingAuthorityGrant[]> {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) throw new GovernanceApiError("WORKSPACE_REQUIRED", 400);
  const response = await fetch("/api/studio/publishing-approval-authority", { headers: { "x-workspace-id": workspaceId }, cache: "no-store" });
  const body = await publishingResponse<{ grants: PublishingAuthorityGrant[] }>(response);
  return body.grants;
}

export async function issuePublishingAuthorityGrant(input: { userId: string; channelId: string; expiresAt: string | null }): Promise<unknown> {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) throw new GovernanceApiError("WORKSPACE_REQUIRED", 400);
  return publishingResponse(await fetch("/api/studio/publishing-approval-authority", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(input),
  }));
}

export async function revokePublishingAuthorityGrant(grantId: string): Promise<unknown> {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) throw new GovernanceApiError("WORKSPACE_REQUIRED", 400);
  return publishingResponse(await fetch(`/api/studio/publishing-approval-authority/${encodeURIComponent(grantId)}`, {
    method: "DELETE",
    headers: { "x-workspace-id": workspaceId, "idempotency-key": crypto.randomUUID() },
  }));
}
