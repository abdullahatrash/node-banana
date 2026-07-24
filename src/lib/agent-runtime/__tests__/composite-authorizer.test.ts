import { describe, expect, it, vi } from "vitest";
import type {
  CapabilityAuthorizationRequest,
  CapabilityAuthorizer,
} from "@/types/agentAuthorization";
import {
  CompositeCapabilityAuthorizer,
  HumanCapabilityAuthorizer,
} from "../composite-authorizer";

function request(
  securityContext: CapabilityAuthorizationRequest["securityContext"],
  audience: CapabilityAuthorizationRequest["audience"] = "human",
): CapabilityAuthorizationRequest {
  return {
    audience,
    securityContext,
    capability: { name: "credentials.profile.list", version: 1 },
    authorizationContractDigest: `sha256:${"a".repeat(64)}`,
    resources: [],
    resourceExtractionValid: true,
  };
}

function database(role: "owner" | "admin" | "member" | undefined) {
  const values = vi.fn(async () => undefined);
  const selectChain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(async () => (role ? [{ role }] : [])),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.innerJoin.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  const tx = {
    select: vi.fn(() => selectChain),
    insert: vi.fn(() => ({ values })),
  };
  return {
    values,
    getDb: () =>
      ({
        transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) =>
          callback(tx),
      }) as never,
  };
}

describe("unified capability authorization", () => {
  it("persists an allowed human manager decision", async () => {
    const db = database("admin");
    const authorizer = new HumanCapabilityAuthorizer(db.getDb);

    const admission = await authorizer.authorize(
      request({
        kind: "human",
        workspaceId: "workspace-1",
        userId: "user-1",
        role: "admin",
      }),
    );

    expect(admission.allowed).toBe(true);
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        actorUserId: "user-1",
        eventType: "authorization.allowed",
        reason: "allowed",
      }),
    );
  });

  it("persists cross-audience attempts as denied decisions", async () => {
    const db = database(undefined);
    const human = new HumanCapabilityAuthorizer(db.getDb);
    const agent: CapabilityAuthorizer = {
      authorize: vi.fn(async () => ({
        allowed: true,
        operatorTraceRef: "trace_agent",
      })),
    };
    const authorizer = new CompositeCapabilityAuthorizer(agent, human);

    const admission = await authorizer.authorize(
      request({
        kind: "agent",
        workspaceId: "workspace-1",
        principalId: "principal-1",
        keyId: "key-1",
      }),
    );

    expect(admission.allowed).toBe(false);
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: "principal-1",
        keyId: "key-1",
        eventType: "authorization.denied",
        reason: "security_context_mismatch",
      }),
    );
    expect(agent.authorize).not.toHaveBeenCalled();
  });
});
