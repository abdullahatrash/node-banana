import { describe, expect, it, vi } from "vitest";
import { ApplicationGovernanceBulkCapabilityPort, GovernanceBulkWorker, WorkflowRunGovernanceBulkQuotePort } from "../bulk-worker";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { GovernanceService } from "../service";
import { canonicalDigest } from "@/lib/agent-tools/canonical";

const now = new Date("2026-09-03T12:00:00.000Z");
const actor = { workspaceId: "portfolio-workspace", userId: "owner-a", legacyRole: "owner" as const, authContextId: "session-owner-a" };
const dispatchCapability = vi.fn();
vi.mock("@/lib/agent-runtime/server-dispatcher", () => ({ dispatchCapability: (...args: unknown[]) => dispatchCapability(...args) }));
const previewPort = { inspect: async () => ({ type: "ready" as const, authorizationEvidenceRef: "test-authorization", authorizationContractDigest: canonicalDigest({ contract: 1 }), targetStateDigest: canonicalDigest({ target: 1 }), entitlement: "exact_capability_granted" as const, quote: { required: false as const, amount: "0" as const, currency: "USD" as const, source: "capability_effect_contract" as const, digest: canonicalDigest({ amount: 0 }) } }) };
const serviceFor = (repository: InMemoryGovernanceRepository, clock = { now: () => new Date(now) }) => new GovernanceService(repository, clock, undefined, undefined, undefined, previewPort);

describe("GovernanceBulkWorker", () => {
  it("issues and revalidates an actor, workflow, model, price, expiry, and target-bound spend quote", async () => {
    const preview = vi.fn().mockResolvedValue({
      schema: "run-admission-preview/v1", workspaceId: "workspace-a", principalId: "owner-a", workflowId: "workflow-a", workflowRevisionId: "revision-a", evaluatedAt: now,
      ceiling: { amount: "1.250000", currency: "USD", certainty: "conservative", fxSnapshotIds: [] },
      applicableCredentialSpendGrants: [], applicablePolicies: [], requiredReservations: [], warnings: [], denialReasons: [], admissible: true,
      stepExposures: [{ stepId: "generate", provider: "replicate", providerOperation: "predict", model: "owner/model@version", serviceTier: "standard", automaticAttempts: 1, credentialSlotId: "replicate", credentialProfileId: null, amountPerAttempt: "1.250000", currency: "USD", pricingSnapshotIds: ["price-1"], pricingSource: "builtin_catalog" }],
    });
    const port = new WorkflowRunGovernanceBulkQuotePort({ preview }, Buffer.alloc(32, 4));
    const request = { sourceWorkspaceId: "portfolio-workspace", requestedByUserId: "owner-a", capability: "workflow_runs.start@2", targetWorkspaceId: "workspace-a", targetKind: "content", targetId: "workflow-a", capabilityInput: { workflowId: "workflow-a", revisionId: "revision-a", idempotencyKey: "run-key-1", inputs: { prompt: "مرحبا" }, inputArtifactIds: [], delegatedAgent: { principalId: "agent-a", keyId: "key-a" } }, quoteRef: null, evaluatedAt: now, targetStateDigest: canonicalDigest({ workflow: "a" }) };
    const issued = await port.quote(request);
    expect(issued).toMatchObject({ required: true, amount: "1.250000", currency: "USD", providerModels: [{ provider: "replicate", model: "owner/model@version", pricingSnapshotIds: ["price-1"] }] });
    const replay = await port.quote({ ...request, quoteRef: issued!.ref, evaluatedAt: new Date("2026-09-03T12:04:00.000Z") });
    expect(replay?.digest).toBe(issued?.digest);
    await expect(port.quote({ ...request, quoteRef: issued!.ref, targetStateDigest: canonicalDigest({ workflow: "changed" }), evaluatedAt: new Date("2026-09-03T12:04:00.000Z") })).resolves.toBeNull();
    await expect(port.quote({ ...request, quoteRef: issued!.ref, evaluatedAt: new Date("2026-09-03T12:06:00.000Z") })).resolves.toBeNull();
  });

  it("executes spending runs only as the delegated Agent and consumes a quote through stable Run idempotency", async () => {
    dispatchCapability.mockResolvedValue({ type: "capability_result", output: { runId: "run-1" } });
    const port = new ApplicationGovernanceBulkCapabilityPort();
    const capabilityInput = { workflowId: "workflow-a", revisionId: "revision-a", idempotencyKey: "caller-key", inputs: {}, inputArtifactIds: [], delegatedAgent: { principalId: "agent-a", keyId: "key-a" } };
    await expect(port.execute({ actor, capability: "workflow_runs.start@2", capabilityInput, idempotencyKey: "bulk-item", acceptedQuoteRef: "signed-quote" })).resolves.toMatchObject({ type: "succeeded" });
    expect(dispatchCapability).toHaveBeenCalledWith(
      { capability: "workflow_runs.start@2", input: expect.objectContaining({ idempotencyKey: expect.stringMatching(/^bulk-quote:sha256:/) }) },
      { securityContext: { kind: "agent", workspaceId: actor.workspaceId, principalId: "agent-a", keyId: "key-a" } },
    );
    expect(dispatchCapability.mock.calls[0]?.[0].input).not.toHaveProperty("delegatedAgent");
    await expect(port.execute({ actor, capability: "workflow_runs.start@2", capabilityInput, idempotencyKey: "bulk-item-2", acceptedQuoteRef: null })).resolves.toEqual({ type: "failed_known", code: "DELEGATED_AGENT_QUOTE_REQUIRED" });
  });

  it("reauthorizes every pinned target Workspace and records independent outcomes", async () => {
    const repository = new InMemoryGovernanceRepository();
    const service = serviceFor(repository);
    const preview = await service.execute(actor, {
      type: "preview_bulk", operationCapability: "content.archive@1", concurrency: 2, quoteRef: "quote-1",
      items: [
        { targetWorkspaceId: "workspace-authorized", targetKind: "content", targetId: "content-1", input: { contentId: "content-1" } },
        { targetWorkspaceId: "workspace-forbidden", targetKind: "content", targetId: "content-2", input: { contentId: "content-2" } },
        { targetWorkspaceId: "workspace-uncertain", targetKind: "content", targetId: "content-3", input: { contentId: "content-3" } },
      ],
    }, "preview-bulk-worker") as { operationId: string };
    await service.execute(actor, { type: "start_bulk", operationId: preview.operationId }, "start-bulk-worker");
    const execute = vi.fn().mockImplementation(async ({ actor: targetActor }: { actor: { workspaceId: string } }) => targetActor.workspaceId === "workspace-uncertain"
      ? { type: "outcome_unknown", safeReason: "provider_timeout" }
      : { type: "succeeded", output: { archived: true } });
    const resolveActor = vi.fn().mockImplementation(async ({ targetWorkspaceId, userId }) => targetWorkspaceId === "workspace-forbidden" ? null : ({ workspaceId: targetWorkspaceId, userId, legacyRole: "admin", authContextId: "bulk-test" }));
    const worker = new GovernanceBulkWorker(repository, { resolveActor }, { execute }, { now: () => new Date("2026-09-03T12:01:00.000Z") });
    await worker.process({ workspaceId: actor.workspaceId, operationId: preview.operationId });

    const operation = await repository.getResource<{ items: Array<{ state: string; outcome: Record<string, unknown> }> }>({ workspaceId: actor.workspaceId, kind: "bulk_operation", id: preview.operationId });
    expect(operation?.status).toBe("outcome_unknown");
    expect(operation?.body.items.map((item) => item.state)).toEqual(["succeeded", "failed_known", "outcome_unknown"]);
    expect(operation?.body.items[1].outcome).toEqual({ code: "TARGET_WORKSPACE_FORBIDDEN" });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0]).toMatchObject({ actor: { workspaceId: "workspace-authorized" }, capability: "content.archive@1", idempotencyKey: expect.stringContaining(preview.operationId) });
    expect(resolveActor).toHaveBeenCalledWith(expect.objectContaining({ sourceWorkspaceId: actor.workspaceId, targetWorkspaceId: "workspace-authorized", userId: actor.userId, capability: "content.archive@1", targetKind: "content", targetId: "content-1", evaluatedAt: new Date("2026-09-03T12:01:00.000Z") }));
  });

  it("turns items left running by an interrupted worker into ambiguity instead of replaying", async () => {
    const repository = new InMemoryGovernanceRepository();
    const service = serviceFor(repository);
    const preview = await service.execute(actor, { type: "preview_bulk", operationCapability: "content.archive@1", concurrency: 1, quoteRef: null, items: [{ targetWorkspaceId: "workspace-a", targetKind: "content", targetId: "content-a" }] }, "preview-interrupted-bulk") as { operationId: string };
    await service.execute(actor, { type: "start_bulk", operationId: preview.operationId }, "start-interrupted-bulk");
    const queued = await repository.getResource({ workspaceId: actor.workspaceId, kind: "bulk_operation", id: preview.operationId });
    await repository.commit({ receipt: { workspaceId: actor.workspaceId, capability: "test.bulk@1", idempotencyKey: "simulate-interrupted-bulk", requestDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", result: {}, createdAt: now }, mutations: [{ type: "update", expectedVersion: queued!.version, resource: { ...queued!, version: queued!.version + 1, status: "running", body: { ...queued!.body, items: (queued!.body as { items: Array<Record<string, unknown>> }).items.map((item) => ({ ...item, state: "running" })) }, updatedAt: now } }], audit: { schema: "workspace-audit-event/v1", id: "audit-interrupted", workspaceId: actor.workspaceId, actor: { kind: "system", id: null }, capability: "test.bulk@1", action: "interrupt", resource: null, outcome: "failed", redactedDetails: {}, occurredAt: now } });
    const execute = vi.fn();
    await new GovernanceBulkWorker(repository, { resolveActor: vi.fn() }, { execute }).process({ workspaceId: actor.workspaceId, operationId: preview.operationId });
    expect((await repository.getResource({ workspaceId: actor.workspaceId, kind: "bulk_operation", id: preview.operationId }))?.status).toBe("outcome_unknown");
    expect(execute).not.toHaveBeenCalled();
  });

  it("claims an exclusive lease so concurrent workers dispatch each item once", async () => {
    const repository = new InMemoryGovernanceRepository();
    const service = serviceFor(repository);
    const preview = await service.execute(actor, { type: "preview_bulk", operationCapability: "content.archive@1", concurrency: 1, quoteRef: null, items: [{ targetWorkspaceId: "workspace-a", targetKind: "content", targetId: "content-a" }] }, "preview-concurrent-bulk") as { operationId: string };
    await service.execute(actor, { type: "start_bulk", operationId: preview.operationId }, "start-concurrent-bulk");
    const execute = vi.fn(async () => ({ type: "succeeded" as const, output: { archived: true } }));
    const authorization = { resolveActor: vi.fn(async ({ targetWorkspaceId, userId }: { targetWorkspaceId: string; userId: string }) => ({ workspaceId: targetWorkspaceId, userId, legacyRole: "admin" as const, authContextId: "bulk-test" })) };
    const clock = { now: () => new Date("2026-09-03T12:01:00.000Z") };
    await Promise.all([
      new GovernanceBulkWorker(repository, authorization, { execute }, clock).process({ workspaceId: actor.workspaceId, operationId: preview.operationId }),
      new GovernanceBulkWorker(repository, authorization, { execute }, clock).process({ workspaceId: actor.workspaceId, operationId: preview.operationId }),
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await repository.getResource({ workspaceId: actor.workspaceId, kind: "bulk_operation", id: preview.operationId }))?.status).toBe("succeeded");
  });

  it("provides a sweeper entry point for expired leases", async () => {
    let current = new Date(now);
    const repository = new InMemoryGovernanceRepository();
    const service = serviceFor(repository);
    const preview = await service.execute(actor, { type: "preview_bulk", operationCapability: "content.archive@1", concurrency: 1, quoteRef: null, items: [{ targetWorkspaceId: "workspace-a", targetKind: "content", targetId: "content-a" }] }, "preview-expired-bulk") as { operationId: string };
    await service.execute(actor, { type: "start_bulk", operationId: preview.operationId }, "start-expired-bulk");
    const queued = await repository.getResource({ workspaceId: actor.workspaceId, kind: "bulk_operation", id: preview.operationId });
    const leased = { ...queued!, version: queued!.version + 1, status: "running", body: { ...queued!.body, lease: { id: "lease-old", claimedAt: now.toISOString(), expiresAt: "2026-09-03T12:05:00.000Z", attempt: 1 } }, updatedAt: now };
    await repository.commit({ receipt: { workspaceId: actor.workspaceId, capability: "test.lease@1", idempotencyKey: "simulate-bulk-lease", requestDigest: canonicalDigest({ id: queued!.id }), result: {}, createdAt: now }, mutations: [{ type: "update", expectedVersion: queued!.version, resource: leased }], audit: { schema: "workspace-audit-event/v1", id: "audit-lease", workspaceId: actor.workspaceId, actor: { kind: "system", id: null }, capability: "test.lease@1", action: "lease", resource: null, outcome: "completed", redactedDetails: {}, occurredAt: now } });
    const worker = new GovernanceBulkWorker(repository, { resolveActor: async ({ targetWorkspaceId, userId }) => ({ workspaceId: targetWorkspaceId, userId, legacyRole: "admin", authContextId: "bulk-test" }) }, { execute: async () => ({ type: "succeeded", output: {} }) }, { now: () => current });
    expect(await worker.recoverExpired({ workspaceId: actor.workspaceId })).toBe(0);
    current = new Date("2026-09-03T12:06:00.000Z");
    expect(await worker.recoverExpired({ workspaceId: actor.workspaceId })).toBe(1);
    expect((await repository.getResource({ workspaceId: actor.workspaceId, kind: "bulk_operation", id: preview.operationId }))?.status).toBe("succeeded");
  });
});
