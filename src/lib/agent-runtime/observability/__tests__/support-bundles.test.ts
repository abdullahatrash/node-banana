import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { describe, expect, it, vi } from "vitest";
import { InMemoryObservabilityRepository } from "../memory";
import { ObservabilityService } from "../service";
import {
  SupportBundleApplication,
  supportBundleIntentMatchesRecord,
  type SupportBundleContentStore,
  type SupportBundleProjectionReader,
} from "../support-bundles";
import type { ObservabilityCursorCodec } from "../types";
import { InMemorySupportBundleBindIntentRepository } from "../support-bundles-memory";

const now = new Date("2026-08-01T12:00:00.000Z");
const later = (seconds: number) => new Date(now.getTime() + seconds * 1_000);
const codec: ObservabilityCursorCodec = {
  encode: async (value) => JSON.stringify(value),
  decode: async (value) => JSON.parse(value),
};

class MemoryContentStore implements SupportBundleContentStore {
  readonly content = new Map<string, Uint8Array>();
  failDelete = false;
  failPut = false;
  putCalls = 0;
  readonly failDeleteKeys = new Set<string>();
  putGate: Promise<void> | null = null;
  putStarted: (() => void) | null = null;

  async put(input: { key: string; bytes: Uint8Array }) {
    this.putCalls += 1;
    if (this.failPut) throw new Error("storage down");
    this.putStarted?.();
    if (this.putGate) await this.putGate;
    this.content.set(input.key, new Uint8Array(input.bytes));
  }
  async get(input: { key: string }) {
    const value = this.content.get(input.key);
    if (!value) throw new Error("missing");
    return new Uint8Array(value);
  }
  async delete(input: { key: string }) {
    if (this.failDelete || this.failDeleteKeys.has(input.key)) throw new Error("storage down");
    this.content.delete(input.key);
  }
}

function setup() {
  const repository = new InMemoryObservabilityRepository();
  const service = new ObservabilityService(repository, codec);
  const store = new MemoryContentStore();
  const intents = new InMemorySupportBundleBindIntentRepository();
  const reader: SupportBundleProjectionReader = {
    project: async ({ resourceId }) => ({
      version: 1,
      canonicalDigest: `sha256:${resourceId === "run_1" ? "a" : "b".repeat(64)}`.replace(
        "sha256:a",
        `sha256:${"a".repeat(64)}`,
      ) as `sha256:${string}`,
      content: {
        schema: "support-run-summary/v1",
        state: "completed",
      },
    }),
  };
  const application = new SupportBundleApplication(service, reader, store, intents);
  return { application, intents, reader, repository, service, store };
}

async function configure(service: ObservabilityService) {
  await service.setRetention({
    workspaceId: "workspace_1",
    metricTtlSeconds: 3600,
    traceTtlSeconds: 600,
    supportBundleTtlSeconds: 60,
    actorUserId: "owner_1",
    idempotencyKey: "retention_1",
    recordedAt: now,
  });
}

function createInput(
  resourceId: string,
  idempotencyKey: string,
  options: {
    recordedAt?: Date;
    purpose?: "incident_diagnosis" | "support_case";
  } = {},
) {
  return {
    workspaceId: "workspace_1",
    actorUserId: "owner_1",
    selections: [
      { resourceKind: "run" as const, resourceId, projectionKind: "run_summary" as const },
    ],
    purpose: options.purpose ?? "incident_diagnosis" as const,
    consentExpiresAt: later(60),
    idempotencyKey,
    recordedAt: options.recordedAt ?? now,
  };
}

describe("SupportBundleApplication", () => {
  it("binds canonical source and redacted projection digests independently", async () => {
    const { application, service, store } = setup();
    await configure(service);
    const first = await application.create(createInput("run_1", "bundle_1"));
    const second = await application.create(createInput("run_2", "bundle_2"));

    expect(first.selections[0]?.reference.digest).not.toBe(
      second.selections[0]?.reference.digest,
    );
    expect(first.selections[0]?.projectedContentDigest).toBe(
      second.selections[0]?.projectedContentDigest,
    );
    expect(first.selections[0]?.projectedContentDigest).toBe(
      canonicalDigest({ schema: "support-run-summary/v1", state: "completed" }),
    );
    expect(store.content.size).toBe(2);
  });

  it("stores before binding, verifies payload bytes and rejects tampering", async () => {
    const { application, service, store } = setup();
    await configure(service);
    const bundle = await application.create(createInput("run_1", "bundle_1"));
    const grant = await service.issueOperatorGrant({
      workspaceId: "workspace_1",
      operatorId: "owner_1",
      scopes: ["support_bundle.read"],
      expiresAt: later(300),
      issuedByUserId: "owner_1",
      actorRole: "owner",
      idempotencyKey: "grant_1",
      recordedAt: now,
    });
    await expect(
      application.readPayload({
        workspaceId: "workspace_1",
        bundleId: bundle.id,
        operatorGrantId: grant.id,
        operatorId: "owner_1",
        at: later(1),
      }),
    ).resolves.toMatchObject({
      payload: { schema: "support-bundle-payload/v1" },
    });

    const key = [...store.content.keys()][0]!;
    store.content.set(key, new TextEncoder().encode('{"schema":"tampered"}'));
    await expect(
      application.readPayload({
        workspaceId: "workspace_1",
        bundleId: bundle.id,
        operatorGrantId: grant.id,
        operatorId: "owner_1",
        at: later(2),
      }),
    ).rejects.toMatchObject({ code: "OBSERVABILITY_UNAVAILABLE" });
  });

  it("retains cleanup claims across storage failure and acks only after retry", async () => {
    const { application, repository, service, store } = setup();
    await configure(service);
    const bundle = await application.create(createInput("run_1", "bundle_1"));
    store.failDelete = true;
    const failed = await application.expireAndDrain({ at: later(61), limit: 10 });
    expect(failed.cleanup).toMatchObject({ scanned: 1, errors: 1, acknowledged: 0 });
    expect(repository.bundles.get(bundle.id)).toMatchObject({
      state: "expired",
      storageKey: expect.any(String),
      contentDigest: expect.any(String),
    });

    store.failDelete = false;
    const retried = await application.expireAndDrain({ at: later(62), limit: 10 });
    expect(retried.cleanup).toMatchObject({ scanned: 1, errors: 0, acknowledged: 1 });
    expect(repository.bundles.get(bundle.id)).toMatchObject({
      storageKey: null,
      contentDigest: null,
    });
  });

  it("isolates same-content bundle keys and removes bytes recreated by inactive replay", async () => {
    const { application, repository, service, store } = setup();
    await configure(service);
    const first = await application.create(createInput("run_1", "bundle_1"));
    const second = await application.create(createInput("run_1", "bundle_2"));
    expect(store.content.size).toBe(2);

    await application.revoke({
      workspaceId: "workspace_1",
      bundleId: first.id,
      actorUserId: "owner_1",
      actorRole: "owner",
      recordedAt: later(1),
    });
    expect(store.content.size).toBe(1);
    expect(repository.bundles.get(second.id)).toMatchObject({ state: "stored" });

    const replay = await application.create(
      createInput("run_1", "bundle_1", { recordedAt: later(5) }),
    );
    expect(replay.state).toBe("revoked");
    expect(store.content.size).toBe(1);
    expect(repository.bundles.get(first.id)).toMatchObject({
      state: "revoked",
      storageKey: null,
      contentDigest: null,
    });
  });

  it("durably reconciles bytes after metadata persistence failure without timestamp drift", async () => {
    const { application, intents, repository, service, store } = setup();
    await configure(service);
    const original = service.createStoredSupportBundle.bind(service);
    vi.spyOn(service, "createStoredSupportBundle")
      .mockRejectedValueOnce(new Error("metadata unavailable"))
      .mockImplementation(original);

    await expect(
      application.create(createInput("run_1", "bundle_retry")),
    ).rejects.toThrow("metadata unavailable");
    expect(store.content.size).toBe(1);
    expect([...intents.intents.values()][0]).toMatchObject({
      state: "pending",
      payloadJson: expect.any(String),
    });

    const replay = await application.create(
      createInput("run_1", "bundle_retry", { recordedAt: later(10) }),
    );
    expect(replay.state).toBe("stored");
    expect(repository.bundles.size).toBe(1);
    expect([...intents.intents.values()][0]).toMatchObject({
      state: "bound",
      payloadJson: null,
      bundleId: replay.id,
    });
  });

  it("does not delete an exact concurrent replay after an ambiguous committed failure", async () => {
    const { application, intents, repository, service, store } = setup();
    await configure(service);
    const original = service.createStoredSupportBundle.bind(service);
    let calls = 0;
    vi.spyOn(service, "createStoredSupportBundle").mockImplementation(async (input) => {
      const result = await original(input);
      calls += 1;
      if (calls === 1) throw new Error("ambiguous response after commit");
      return result;
    });

    const results = await Promise.allSettled([
      application.create(createInput("run_1", "bundle_concurrent")),
      application.create(
        createInput("run_1", "bundle_concurrent", { recordedAt: later(2) }),
      ),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(repository.bundles.size).toBe(1);
    expect(store.content.size).toBe(1);
    expect([...intents.intents.values()][0]).toMatchObject({ state: "bound" });
  });

  it("serializes a delayed writer against expired reconciliation across application instances", async () => {
    const { application, intents, reader, repository, service, store } = setup();
    await configure(service);
    const second = new SupportBundleApplication(service, reader, store, intents);
    let releasePut!: () => void;
    store.putGate = new Promise<void>((resolve) => { releasePut = resolve; });
    let notifyPut!: () => void;
    const putStarted = new Promise<void>((resolve) => { notifyPut = resolve; });
    store.putStarted = notifyPut;

    const create = application.create(createInput("run_1", "bundle_delayed"));
    await putStarted;
    const maintenance = second.expireAndDrain({ at: later(61), limit: 10 });
    await Promise.resolve();
    expect(repository.bundles.size).toBe(0);

    releasePut();
    await create;
    const result = await maintenance;

    expect(result.intents).toEqual({ scanned: 1, bound: 1, abandoned: 0, errors: 0 });
    expect(result.expired.bundles).toBe(1);
    expect(result.cleanup).toEqual({ scanned: 1, deleted: 1, acknowledged: 1, errors: 0 });
    expect(store.content.size).toBe(0);
    expect([...intents.intents.values()][0]).toMatchObject({ state: "cleanup", payloadJson: null });
    expect([...repository.bundles.values()][0]).toMatchObject({ state: "expired", storageKey: null });

    const tombstone = [...intents.intents.values()][0]!;
    store.content.set(tombstone.storageKey, new Uint8Array([1]));
    await second.drainCleanup({ at: later(122), limit: 10 });
    expect(store.content.size).toBe(0);
  });

  it("rejects a conflicting idempotency replay before writing alternate bytes", async () => {
    const { application, service, store } = setup();
    await configure(service);
    const original = service.createStoredSupportBundle.bind(service);
    vi.spyOn(service, "createStoredSupportBundle")
      .mockRejectedValueOnce(new Error("metadata unavailable"))
      .mockImplementation(original);
    await expect(
      application.create(createInput("run_1", "bundle_conflict")),
    ).rejects.toThrow();
    const keys = [...store.content.keys()];
    await expect(
      application.create(
        createInput("run_1", "bundle_conflict", { purpose: "support_case" }),
      ),
    ).rejects.toMatchObject({ code: "OBSERVABILITY_CONFLICT" });
    expect([...store.content.keys()]).toEqual(keys);
  });

  it("uses distinct durable intent identities for distinct idempotency keys", async () => {
    const { application, intents, service } = setup();
    await configure(service);
    vi.spyOn(service, "createStoredSupportBundle").mockRejectedValue(new Error("metadata unavailable"));
    await expect(application.create(createInput("run_1", "bundle_a"))).rejects.toThrow();
    await expect(application.create(createInput("run_1", "bundle_b"))).rejects.toThrow();
    expect(new Set([...intents.intents.values()].map((intent) => intent.id)).size).toBe(2);
  });

  it("prevalidates identifiers and timestamps before persisting an intent", async () => {
    const { application, intents, service } = setup();
    await configure(service);
    await expect(application.create({ ...createInput("run_1", "bundle_invalid"), actorUserId: "secret actor with spaces" })).rejects.toMatchObject({ code: "OBSERVABILITY_INVALID_INPUT" });
    await expect(application.create({ ...createInput("run_1", "bundle_invalid"), actorUserId: " owner_1" })).rejects.toMatchObject({ code: "OBSERVABILITY_INVALID_INPUT" });
    await expect(application.create({ ...createInput("run_1", "bundle_invalid"), recordedAt: new Date("invalid") })).rejects.toMatchObject({ code: "OBSERVABILITY_INVALID_INPUT" });
    expect(intents.intents.size).toBe(0);
  });

  it("rejects a malformed projection reader result before persisting an intent", async () => {
    const { intents, service, store } = setup();
    await configure(service);
    const malformed: SupportBundleProjectionReader = {
      project: async () => ({ version: 0, canonicalDigest: "not-a-digest" as `sha256:${string}`, content: null as unknown as Record<string, unknown> }),
    };
    const application = new SupportBundleApplication(service, malformed, store, intents);
    await expect(application.create(createInput("run_1", "malformed_reader"))).rejects.toMatchObject({ code: "OBSERVABILITY_UNAVAILABLE" });
    expect(intents.intents.size).toBe(0);
  });

  it("defers a failing oldest cohort so a newer pending intent is not starved", async () => {
    const { application, intents, repository, service } = setup();
    await configure(service);
    const original = service.createStoredSupportBundle.bind(service);
    const spy = vi.spyOn(service, "createStoredSupportBundle").mockRejectedValue(new Error("metadata unavailable"));
    await expect(application.create(createInput("run_1", "poison_1"))).rejects.toThrow();
    await expect(application.create(createInput("run_1", "poison_2", { recordedAt: later(1) }))).rejects.toThrow();
    await expect(application.create(createInput("run_1", "valid_3", { recordedAt: later(2) }))).rejects.toThrow();
    spy.mockImplementation((input) => input.idempotencyKey.startsWith("poison_") ? Promise.reject(new Error("still unavailable")) : original(input));

    expect(await application.reconcilePending({ at: later(3), limit: 2 })).toEqual({ scanned: 2, bound: 0, abandoned: 0, errors: 2 });
    expect(await application.reconcilePending({ at: later(3), limit: 2 })).toEqual({ scanned: 1, bound: 1, abandoned: 0, errors: 0 });
    expect(repository.bundles.size).toBe(1);
    expect([...intents.intents.values()].find((intent) => intent.idempotencyKey === "valid_3")).toMatchObject({ state: "bound", payloadJson: null });
  });

  it("abandons an expired pending intent before any retry write and cleans late bytes", async () => {
    const { application, intents, repository, service, store } = setup();
    await configure(service);
    store.failPut = true;
    await expect(application.create(createInput("run_1", "bundle_expired_pending"))).rejects.toThrow();
    expect(store.putCalls).toBe(1);
    store.failPut = false;

    const result = await application.expireAndDrain({ at: later(61), limit: 10 });

    expect(result.intents).toEqual({ scanned: 1, bound: 0, abandoned: 1, errors: 0 });
    expect(result.expired.bundles).toBe(0);
    expect(store.putCalls).toBe(1);
    expect(store.content.size).toBe(0);
    const abandoned = [...intents.intents.values()][0]!;
    expect(abandoned).toMatchObject({ state: "abandoned", payloadJson: null, bundleId: null });
    expect(repository.bundles.size).toBe(0);

    store.content.set(abandoned.storageKey, new Uint8Array([1]));
    await application.drainCleanup({ at: later(122), limit: 10 });
    expect(store.content.size).toBe(0);
  });

  it("fairly rotates durable cleanup tombstones beyond the maintenance limit", async () => {
    const { application, intents, service, store } = setup();
    await configure(service);
    const bundles = await Promise.all([1, 2, 3].map((index) => application.create(createInput("run_1", `cleanup_${index}`))));
    for (const [index, bundle] of bundles.entries()) {
      await application.revoke({ workspaceId: "workspace_1", bundleId: bundle.id, actorUserId: "owner_1", actorRole: "owner", recordedAt: later(index + 1) });
    }
    const cleanupIntents = [...intents.intents.values()].sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime());
    for (const intent of cleanupIntents) store.content.set(intent.storageKey, new Uint8Array([1]));
    store.failDeleteKeys.add(cleanupIntents[0]!.storageKey);

    await application.drainCleanup({ at: later(70), limit: 2 });
    expect(store.content.size).toBe(2);
    await application.drainCleanup({ at: later(70), limit: 2 });
    expect(store.content.size).toBe(1);
    store.failDeleteKeys.clear();
    await application.drainCleanup({ at: later(131), limit: 2 });
    await application.drainCleanup({ at: later(131), limit: 2 });
    expect(store.content.size).toBe(0);
  });

  it("refuses to bind mismatched metadata against the frozen intent", async () => {
    const { application, intents, service } = setup();
    await configure(service);
    vi.spyOn(service, "createStoredSupportBundle").mockRejectedValueOnce(new Error("metadata unavailable"));
    await expect(application.create(createInput("run_1", "bundle_metadata_guard"))).rejects.toThrow();
    const intent = [...intents.intents.values()][0]!;
    const exact = {
      schema: "support-bundle/v1" as const,
      id: "bundle_1",
      workspaceId: intent.workspaceId,
      state: "stored" as const,
      selections: intent.selections,
      consent: intent.consent,
      storageKey: intent.storageKey,
      contentDigest: intent.contentDigest,
      sizeBytes: intent.sizeBytes,
      createdAt: intent.createdAt,
      expiresAt: intent.consent.expiresAt,
      storedAt: intent.createdAt,
    };
    const matches = (bundle: typeof exact) => supportBundleIntentMatchesRecord({ intent, bundle, idempotencyKey: intent.idempotencyKey, requestDigest: intent.requestDigest });
    expect(matches(exact)).toBe(true);
    expect(matches({ ...exact, contentDigest: `sha256:${"f".repeat(64)}` })).toBe(false);
    expect(matches({ ...exact, sizeBytes: exact.sizeBytes + 1 })).toBe(false);
    expect(matches({ ...exact, storageKey: `${exact.storageKey}-forged` })).toBe(false);
    expect(matches({ ...exact, consent: { ...exact.consent, purpose: "support_case" } })).toBe(false);
    expect(matches({ ...exact, selections: [] })).toBe(false);
    expect(intent).toMatchObject({ state: "pending", payloadJson: expect.any(String) });
  });
});
