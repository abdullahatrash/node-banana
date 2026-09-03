import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const authorize = vi.fn();
const dispatch = vi.fn();
const send = vi.fn();

vi.mock("@/lib/db", () => ({ isDatabaseConfigured: vi.fn(() => true), getDb: vi.fn(() => ({})) }));
vi.mock("@/lib/studio/authz", () => ({
  authorizeStudioRequest: (...args: unknown[]) => authorize(...args),
  authzErrorResponse: (result: { status: number; error: string }) => NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));
vi.mock("@/lib/agent-runtime/server-dispatcher", () => ({
  dispatchCapability: (...args: unknown[]) => dispatch(...args),
  PRODUCTION_CAPABILITY_REGISTRY: { getDefinition: vi.fn(() => ({ identity: { name: "members.invite", version: 1 } })) },
}));
vi.mock("@/lib/auth/email-sender", () => ({ getEmailSender: () => ({ send }) }));
vi.mock("@/lib/governance/production", () => ({
  getProductionGovernanceApprovalDeadlineWorker: vi.fn(), getProductionGovernanceBulkWorker: vi.fn(), getProductionGovernanceExportWorker: vi.fn(), getProductionGovernanceImportWorker: vi.fn(),
}));

import { POST } from "../route";

function request(input: { origin?: string; workspace?: string; idempotency?: string; body: unknown }) {
  const headers = new Headers({ "content-type": "application/json" });
  if (input.origin) headers.set("origin", input.origin);
  if (input.workspace) headers.set("x-workspace-id", input.workspace);
  if (input.idempotency) headers.set("idempotency-key", input.idempotency);
  return new NextRequest("http://localhost:3000/api/studio/governance/capabilities", { method: "POST", headers, body: JSON.stringify(input.body) });
}

describe("governance capability route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ authorized: true, workspaceId: "workspace-a", userId: "owner-a", role: "owner", authContextId: "session-owner-a", permissions: [], contentSession: { authContextId: "session-owner-a", user: { id: "owner-a", email: "owner@example.com", name: null }, workspace: { id: "workspace-a", organizationId: "org-a" }, role: "owner", planTier: "free", permissions: [] } });
  });

  it("rejects cross-origin mutations before dispatch", async () => {
    const response = await POST(request({ origin: "https://evil.example", workspace: "workspace-a", idempotency: "stable-key-1", body: { capability: "members.invite@1", input: { command: { type: "create_invitation", email: "new@example.com", binding: { kind: "built_in", role: "viewer" }, expiresAt: "2026-09-10T12:00:00.000Z" } } } }));
    expect(response.status).toBe(403);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("pins server-owned Workspace context, delivers invitation secret, and redacts it from HTTP output", async () => {
    dispatch.mockResolvedValue({ type: "capability_result", capability: { name: "members.invite", version: 1 }, output: { result: { invitationId: "invite-1", invitationToken: "opaque-secret", expiresAt: "2026-09-10T12:00:00.000Z" } } });
    const response = await POST(request({ origin: "http://localhost:3000", workspace: "workspace-a", idempotency: "stable-key-2", body: { capability: "members.invite@1", input: { command: { type: "create_invitation", email: "new@example.com", binding: { kind: "built_in", role: "viewer" }, expiresAt: "2026-09-10T12:00:00.000Z" } } } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, result: { invitationId: "invite-1" } });
    expect(dispatch).toHaveBeenCalledWith(expect.anything(), { securityContext: { kind: "human", workspaceId: "workspace-a", userId: "owner-a", role: "owner", authContextId: "session-owner-a", idempotencyKey: "stable-key-2" } });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "new@example.com", text: expect.stringContaining("opaque-secret") }));
    expect(JSON.stringify(await (async () => ({ invitationId: "invite-1" }))())).not.toContain("opaque-secret");
  });

  it("rejects malformed or unknown command fields at the HTTP boundary", async () => {
    const response = await POST(request({ origin: "http://localhost:3000", workspace: "workspace-a", idempotency: "stable-key-malformed", body: { capability: "members.invite@1", input: { command: { type: "create_invitation", email: "not-an-email", binding: { kind: "built_in", role: "viewer" }, expiresAt: "not-a-date", workspaceId: "workspace-spoofed" } } } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, code: "INVALID_INPUT" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("requires the exact authorized Workspace header", async () => {
    const response = await POST(request({ origin: "http://localhost:3000", workspace: "workspace-b", idempotency: "stable-key-3", body: { capability: "members.manage@1", input: { command: { type: "remove_member", userId: "user-b" } } } }));
    expect(response.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
