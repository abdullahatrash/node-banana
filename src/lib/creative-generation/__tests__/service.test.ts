// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { resolveTestModel, testRef } from "@/lib/model-routing/__tests__/fixtures";
import { CreativeGenerationService, type CreativeActor, type CreativeGenerationPorts } from "../service";
import { CreativeError } from "../contracts";
import { acceptVisualReview, assertCreativePublishable, inspectCreativePlate } from "../review";
import type { CreativeSession, CreativeSessionStore } from "../session";
import { brand, copy, request, sha } from "./fixtures";

class MemoryStore implements CreativeSessionStore {
  rows = new Map<string, CreativeSession>();
  receipts = new Map<string, { digest: string; session: CreativeSession }>();
  async get(workspaceId: string, id: string) { return structuredClone(this.rows.get(`${workspaceId}:${id}`) ?? null); }
  async create(session: CreativeSession, key: string, digest: string) {
    const old = this.receipts.get(`${session.workspaceId}:${key}`);
    if (old) { if (old.digest !== digest) throw new CreativeError("creative.errors.idempotencyConflict"); return structuredClone(old.session); }
    this.rows.set(`${session.workspaceId}:${session.id}`, structuredClone(session)); this.receipts.set(`${session.workspaceId}:${key}`, { digest, session: structuredClone(session) }); return structuredClone(session);
  }
  async mutate(input: Parameters<CreativeSessionStore["mutate"]>[0], change: (value: CreativeSession) => CreativeSession) {
    const old = this.receipts.get(`${input.workspaceId}:${input.idempotencyKey}`);
    if (old) { if (old.digest !== input.requestDigest) throw new CreativeError("creative.errors.idempotencyConflict"); return structuredClone(old.session); }
    const row = await this.get(input.workspaceId, input.id);
    if (!row) throw new CreativeError("creative.errors.notFound");
    if (row.revision !== input.expectedRevision) throw new CreativeError("creative.errors.revisionConflict");
    const next = { ...change(row), revision: row.revision + 1 };
    this.rows.set(`${input.workspaceId}:${input.id}`, structuredClone(next)); this.receipts.set(`${input.workspaceId}:${input.idempotencyKey}`, { digest: input.requestDigest, session: structuredClone(next) }); return next;
  }
}
const actor: CreativeActor = { workspaceId: "workspace-1", userId: "user-1", role: "owner", planTier: "pro" };
function setup() {
  const store = new MemoryStore();
  const ports: CreativeGenerationPorts = { store, loadBrand: vi.fn(async () => ({ workspaceId: "workspace-1", profileId: "brand-1", revision: 3, acceptedAt: "2026-09-05T00:00:00Z", profile: brand })), validateSourcesAndRights: vi.fn(async () => {}), resolveModel: resolveTestModel, admit: vi.fn(async () => ({ ok: true, status: 202, value: { intentId: "intent-1", operation: { id: "operation-1" }, provider: null, operationHref: "/studio/operations" } }) as Awaited<ReturnType<CreativeGenerationPorts["admit"]>>), observe: vi.fn(async () => ({ state: "succeeded", text: JSON.stringify(copy()), metadata: {} })), cancel: vi.fn(async () => ({ kind: "outcome_unknown" })), inspector: { inspect: vi.fn(async () => null) } };
  return { store, ports, service: new CreativeGenerationService(ports, () => "2026-09-05T00:00:00Z") };
}
let fixture: ReturnType<typeof setup>;
beforeEach(() => { fixture = setup(); });

describe("creative generation orchestration", () => {
  it("persists a pinned request once and rejects key reuse/cross-Workspace reads", async () => {
    const created = await fixture.service.create(actor, request());
    expect(await fixture.service.create(actor, request())).toEqual(created);
    await expect(fixture.service.create(actor, { ...request(), fundingMode: "byok" })).rejects.toThrow("creative.errors.idempotencyConflict");
    await expect(fixture.service.get({ ...actor, workspaceId: "other" }, created.id)).rejects.toThrow("creative.errors.notFound");
    expect(fixture.ports.admit).not.toHaveBeenCalled();
  });
  it("lets copy edits and exact approval advance revisions without provider or credit calls", async () => {
    let session = await fixture.service.create(actor, request());
    session = await fixture.service.edit(actor, session.id, { expectedRevision: 1, idempotencyKey: "edit-key-1", copy: copy(), composition: null });
    session = await fixture.service.approveCopy(actor, session.id, { expectedRevision: 2, idempotencyKey: "approve-key-1", copyDigest: canonicalDigest(session.copy) });
    expect(session.copyApproval?.digest).toBe(canonicalDigest(copy()));
    await expect(fixture.service.edit(actor, session.id, { expectedRevision: 2, idempotencyKey: "edit-key-stale", copy: copy(), composition: null })).rejects.toThrow("creative.errors.revisionConflict");
    expect(fixture.ports.admit).not.toHaveBeenCalled();
  });
  it("pins managed and BYOK separately and preserves quote confirmation without admitting a stage", async () => {
    for (const fundingMode of ["managed", "byok"] as const) {
      fixture = setup();
      const session = await fixture.service.create(actor, { ...request(), fundingMode });
      vi.mocked(fixture.ports.admit).mockResolvedValue({ ok: false, status: 409, code: "MANAGED_CREDIT_CONFIRMATION_REQUIRED" });
      const result = await fixture.service.admit(actor, session.id, { expectedRevision: 1, idempotencyKey: "admit-key-1", stage: "copy", model: { ...testRef(9), provider: "replicate" }, regenerate: false });
      expect(result.session.stages).toEqual([]);
      expect(fixture.ports.admit).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ fundingMode, pinnedBrand: request().brand, promptVersion: "tasmeemai-creative-prompt/v1" }) }));
    }
  });
  it("requires exact copy approval before visual generation and blocks unqualified output shapes", async () => {
    let session = await fixture.service.create(actor, request());
    const command = { expectedRevision: 1, idempotencyKey: "admit-key-1", stage: "visual" as const, model: { ...testRef(0), provider: "replicate" as const }, regenerate: false };
    await expect(fixture.service.admit(actor, session.id, command)).rejects.toThrow("creative.errors.copyApprovalRequired");
    session = await fixture.service.edit(actor, session.id, { expectedRevision: 1, idempotencyKey: "edit-key-1", copy: copy(), composition: null });
    session = await fixture.service.approveCopy(actor, session.id, { expectedRevision: 2, idempotencyKey: "approve-key-1", copyDigest: canonicalDigest(session.copy) });
    await expect(fixture.service.admit(actor, session.id, { ...command, expectedRevision: 3 })).rejects.toThrow("creative.errors.modelOutputMismatch");
    expect(fixture.ports.admit).not.toHaveBeenCalled();
  });
  it("collects validated copy while retaining provider lineage and requires explicit regeneration", async () => {
    let session = await fixture.service.create(actor, request());
    const command = { expectedRevision: 1, idempotencyKey: "admit-key-1", stage: "copy" as const, model: { ...testRef(9), provider: "replicate" as const }, regenerate: false };
    session = (await fixture.service.admit(actor, session.id, command)).session;
    expect(session.stages[0]?.intentId).toBe("intent-1");
    session = await fixture.service.collect(actor, session.id, { expectedRevision: 2, idempotencyKey: "collect-key-1", stage: "copy" });
    expect(session.copy).toEqual(copy()); expect(session.copyApproval).toBeNull();
    await expect(fixture.service.admit(actor, session.id, { ...command, expectedRevision: 3 })).rejects.toThrow("creative.errors.regenerationExplicit");
    vi.mocked(fixture.ports.observe).mockResolvedValue({ state: "outcome_unknown", metadata: { credits: "held" } });
    await expect(fixture.service.admit(actor, session.id, { ...command, expectedRevision: 3, regenerate: true })).rejects.toThrow("creative.errors.outcomeUnknown");
    expect(fixture.ports.admit).toHaveBeenCalledTimes(1);
  });
  it("records cancellation before propagating it, preserves unknown outcomes, and prevents collection", async () => {
    let session = await fixture.service.create(actor, request());
    session = (await fixture.service.admit(actor, session.id, { expectedRevision: 1, idempotencyKey: "admit-key-1", stage: "copy", model: { ...testRef(9), provider: "replicate" }, regenerate: false })).session;
    vi.mocked(fixture.ports.observe).mockResolvedValue({ state: "waiting_provider", metadata: {} });
    const result = await fixture.service.cancel(actor, session.id, { expectedRevision: 2, idempotencyKey: "cancel-key-1" });
    expect(result.session.cancellationRequestedAt).toBeTruthy();
    expect(result.outcomes).toEqual([{ kind: "outcome_unknown" }]);
    vi.mocked(fixture.ports.observe).mockResolvedValue({ state: "succeeded", text: JSON.stringify(copy()), metadata: {} });
    await expect(fixture.service.collect(actor, session.id, { expectedRevision: 3, idempotencyKey: "collect-key-1", stage: "copy" })).rejects.toThrow("creative.errors.cancelled");
    expect(fixture.ports.admit).toHaveBeenCalledTimes(1);
  });
  it("preserves provider failure without collecting or automatically retrying", async () => {
    let session = await fixture.service.create(actor, request());
    session = (await fixture.service.admit(actor, session.id, { expectedRevision: 1, idempotencyKey: "admit-key-1", stage: "copy", model: { ...testRef(9), provider: "replicate" }, regenerate: false })).session;
    vi.mocked(fixture.ports.observe).mockResolvedValue({ state: "failed_known", metadata: { credits: "released" } });
    await expect(fixture.service.collect(actor, session.id, { expectedRevision: 2, idempotencyKey: "collect-key-1", stage: "copy" })).rejects.toThrow("creative.errors.providerFailed");
    expect(fixture.ports.admit).toHaveBeenCalledTimes(1);
    expect((await fixture.store.get(actor.workspaceId, session.id))?.stages).toHaveLength(1);
  });
  it("cancels an unbound credit reservation when cancellation wins an admission race", async () => {
    const session = await fixture.service.create(actor, request());
    const admitted = await fixture.ports.admit({ ...actor, idempotencyKey: "unused", input: {} as Parameters<CreativeGenerationPorts["admit"]>[0]["input"] });
    vi.mocked(fixture.ports.admit).mockClear();
    vi.mocked(fixture.ports.admit).mockImplementationOnce(async () => {
      await fixture.service.cancel(actor, session.id, { expectedRevision: 1, idempotencyKey: "racing-cancel-key" });
      return admitted;
    });
    await expect(fixture.service.admit(actor, session.id, { expectedRevision: 1, idempotencyKey: "racing-admit-key", stage: "copy", model: { ...testRef(9), provider: "replicate" }, regenerate: false })).rejects.toThrow("creative.errors.revisionConflict");
    expect(fixture.ports.cancel).toHaveBeenCalledWith(actor, expect.objectContaining({ intentId: "intent-1" }), expect.stringContaining("unbound-cancel"));
    expect((await fixture.store.get(actor.workspaceId, session.id))?.cancellationRequestedAt).toBeTruthy();
  });
});

describe("visible text/watermark review gates", () => {
  it("makes unavailable detection an acknowledged human review warning", async () => {
    const review = await inspectCreativePlate({ inspect: async () => null }, { workspaceId: actor.workspaceId, assetId: "plate", plateDigest: sha });
    expect(review.detection.status).toBe("unavailable"); expect(review.decision).toBe("pending");
    expect(() => acceptVisualReview(review, { plateDigest: sha, acknowledgedFindingsDigest: sha, userId: actor.userId, at: "2026-09-05T00:00:00Z" })).toThrow("creative.errors.visualReviewRequired");
    expect(acceptVisualReview(review, { plateDigest: sha, acknowledgedFindingsDigest: canonicalDigest(review.detection), userId: actor.userId, at: "2026-09-05T00:00:00Z" }).decision).toBe("accepted");
  });
  it("rejects high-confidence watermarks and binds inspection to actual plate bytes", async () => {
    const inspect = vi.fn(async () => ({ schema: "creative-plate-inspection/v1", plateDigest: sha, detectorId: "local-ocr", detectorVersion: "1", findings: [{ kind: "watermark", confidence: 0.95 }] }));
    const review = await inspectCreativePlate({ inspect }, { workspaceId: actor.workspaceId, assetId: "plate", plateDigest: sha });
    expect(review.decision).toBe("rejected");
    expect(() => acceptVisualReview(review, { plateDigest: sha, acknowledgedFindingsDigest: canonicalDigest(review.detection), userId: actor.userId, at: "2026-09-05T00:00:00Z" })).toThrow("creative.errors.visualReviewRequired");
    const mismatch = await inspectCreativePlate({ inspect }, { workspaceId: actor.workspaceId, assetId: "plate", plateDigest: `sha256:${"b".repeat(64)}` });
    expect(mismatch.detection.status).toBe("unavailable"); expect(inspect).toHaveBeenCalledTimes(2);
  });
  it("does not treat copy acceptance as publication approval", async () => {
    const session = await fixture.service.create(actor, request());
    expect(() => assertCreativePublishable(session)).toThrow("creative.errors.copyApprovalRequired");
  });
});
