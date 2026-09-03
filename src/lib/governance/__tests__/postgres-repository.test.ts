import { describe, expect, it, vi } from "vitest";
import { DrizzleGovernanceRepository } from "../postgres-repository";

describe("DrizzleGovernanceRepository", () => {
  it("rejects any cross-Workspace mutation bundle before opening a transaction", async () => {
    const database = vi.fn(() => { throw new Error("database must not be reached"); });
    const repository = new DrizzleGovernanceRepository(database as never);
    const now = new Date("2026-09-03T12:00:00.000Z");
    const result = await repository.commit({
      receipt: { workspaceId: "workspace-a", capability: "governance.test@1", idempotencyKey: "workspace-mismatch", requestDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", result: {}, createdAt: now },
      mutations: [{ type: "create", expectedVersion: null, resource: { id: "portfolio-a", workspaceId: "workspace-b", kind: "portfolio", version: 1, status: "active", body: {}, createdByUserId: "owner-a", createdAt: now, updatedAt: now } }],
      audit: { schema: "workspace-audit-event/v1", id: "audit-a", workspaceId: "workspace-a", actor: { kind: "human", id: "owner-a" }, capability: "governance.test@1", action: "test", resource: null, outcome: "completed", redactedDetails: {}, occurredAt: now },
    });
    expect(result).toEqual({ type: "conflict" });
    expect(database).not.toHaveBeenCalled();
  });

  it("rejects cross-Workspace canonical effects before opening a transaction", async () => {
    const database = vi.fn(() => { throw new Error("database must not be reached"); });
    const repository = new DrizzleGovernanceRepository(database as never);
    const now = new Date("2026-09-03T12:00:00.000Z");
    const result = await repository.commit({
      receipt: { workspaceId: "workspace-a", capability: "members.manage@1", idempotencyKey: "workspace-effect-mismatch", requestDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", result: {}, createdAt: now },
      mutations: [],
      canonicalEffects: [{ type: "membership_remove", workspaceId: "workspace-b", userId: "user-b", occurredAt: now }],
      audit: { schema: "workspace-audit-event/v1", id: "audit-a", workspaceId: "workspace-a", actor: { kind: "human", id: "owner-a" }, capability: "members.manage@1", action: "remove_member", resource: null, outcome: "completed", redactedDetails: {}, occurredAt: now },
    });
    expect(result).toEqual({ type: "conflict" });
    expect(database).not.toHaveBeenCalled();
  });
});
