import { describe, expect, it } from "vitest";
import { InMemoryCredentialVaultRepository } from "../memory-repository";

async function setup(limitCents = 10) {
  const repository = new InMemoryCredentialVaultRepository();
  repository.addAdministrator("workspace-1", "human-1");
  repository.addPrincipal("workspace-1", "principal-1");
  const profile = await repository.createProfile({
    id: "profile-1",
    versionId: "version-1",
    slotId: "slot-1",
    workspaceId: "workspace-1",
    actorUserId: "human-1",
    name: "Provider",
    provider: "openai",
    slotName: "primary",
    secretCiphertext: "ciphertext",
    secretHint: "••••1234",
    now: new Date("2026-07-25T00:00:00.000Z"),
    receipt: {
      capabilityIdentity: "credentials.profiles.create@1",
      idempotencyKey: "receipt-state-profile",
      requestFingerprint: `sha256:${"a".repeat(64)}`,
    },
  });
  expect(profile).not.toBeNull();
  const grant = await repository.createSpendGrant({
    id: "grant-1",
    workspaceId: "workspace-1",
    actorUserId: "human-1",
    principalId: "principal-1",
    profileId: "profile-1",
    mode: "bounded",
    limitCents,
    now: new Date("2026-07-25T00:00:00.000Z"),
    receipt: {
      capabilityIdentity: "credentials.spend_grants.create@1",
      idempotencyKey: "receipt-state-grant",
      requestFingerprint: `sha256:${"b".repeat(64)}`,
    },
  });
  expect(grant).not.toBeNull();
  return repository;
}

function intent(effectRef: string, priceCeilingCents = 1) {
  return {
    effectRef,
    workspaceId: "workspace-1",
    principalId: "principal-1",
    slotId: "slot-1",
    profileId: "profile-1",
    versionId: "version-1",
    version: 1,
    provider: "openai",
    spendGrantId: "grant-1",
    priceCeilingCents,
    providerOperation: "responses.create",
    workflowStepRef: {
      workflowId: "workflow-1",
      workflowRevision: "revision-1",
      nodeId: "node-openai",
      operationIdentity: "openai.responses.create@1",
    },
    providerIntentDigest: `sha256:${"a".repeat(64)}`,
    snapshottedAt: "2026-07-25T00:00:00.000Z",
  };
}

function reservation(effectRef: string, fingerprint: string, quote = 4) {
  return {
    intent: intent(effectRef),
    requestFingerprint: fingerprint,
    priceCeilingCents: quote,
    eventId: `event-${effectRef}`,
    now: new Date("2026-07-25T00:00:01.000Z"),
  };
}

describe("credential effect receipt state", () => {
  it("returns a stored safe result for completed replay and conflicts on drift", async () => {
    const repository = await setup();
    const fingerprint = `sha256:${"b".repeat(64)}`;
    await expect(
      repository.reserveEffect(reservation("effect-1", fingerprint)),
    ).resolves.toMatchObject({ kind: "reserved" });
    await expect(
      repository.reserveEffect(reservation("effect-1", fingerprint)),
    ).resolves.toEqual({
      kind: "reconciliation_required",
      status: "pending",
    });

    const safeResult = { providerRequestId: "request-1", accepted: true };
    await expect(
      repository.completeEffect({
        workspaceId: "workspace-1",
        effectRef: "effect-1",
        requestFingerprint: fingerprint,
        safeResult,
        now: new Date("2026-07-25T00:00:02.000Z"),
      }),
    ).resolves.toBe(true);
    await expect(
      repository.reserveEffect(reservation("effect-1", fingerprint)),
    ).resolves.toMatchObject({
      kind: "completed",
      safeResult,
    });
    await expect(
      repository.reserveEffect(
        reservation("effect-1", `sha256:${"c".repeat(64)}`),
      ),
    ).resolves.toEqual({ kind: "conflict" });
    expect(repository.spendEvents).toHaveLength(1);
    expect(
      repository.effectAuditEvents.map((event) => ({
        type: event.eventType,
        sequence: event.effectSequence,
      })),
    ).toEqual([
      { type: "effect.reserved", sequence: 1 },
      { type: "effect.completed", sequence: 2 },
      { type: "effect.replayed", sequence: 3 },
    ]);
  });

  it("releases a failed-before-start quote but never reuses its effect reference", async () => {
    const repository = await setup();
    const fingerprint = `sha256:${"d".repeat(64)}`;
    await repository.reserveEffect(reservation("effect-failed", fingerprint, 8));
    await expect(
      repository.failEffectBeforeStart({
        workspaceId: "workspace-1",
        effectRef: "effect-failed",
        requestFingerprint: fingerprint,
        failureCode: "ADAPTER_VALIDATION_FAILED",
        now: new Date("2026-07-25T00:00:02.000Z"),
      }),
    ).resolves.toBe(true);
    expect(
      (await repository.listSpendGrants("workspace-1"))[0]?.spentCents,
    ).toBe(0);
    await expect(
      repository.reserveEffect(
        reservation("effect-failed", fingerprint, 8),
      ),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      repository.reserveEffect(
        reservation("effect-new-reference", fingerprint, 8),
      ),
    ).resolves.toMatchObject({ kind: "reserved" });
    expect(
      repository.effectAuditEvents
        .filter((event) => event.effectRef === "effect-failed")
        .map((event) => event.eventType),
    ).toEqual([
      "effect.reserved",
      "effect.failed",
      "effect.released",
    ]);
  });

  it("holds unknown spend and requires reconciliation instead of blind retry", async () => {
    const repository = await setup();
    const fingerprint = `sha256:${"e".repeat(64)}`;
    await repository.reserveEffect(reservation("effect-unknown", fingerprint, 7));
    await expect(
      repository.markEffectUnknown({
        workspaceId: "workspace-1",
        effectRef: "effect-unknown",
        requestFingerprint: fingerprint,
        failureCode: "PROVIDER_OUTCOME_UNKNOWN",
        now: new Date("2026-07-25T00:00:02.000Z"),
      }),
    ).resolves.toBe(true);
    expect(
      (await repository.listSpendGrants("workspace-1"))[0]?.spentCents,
    ).toBe(7);
    await expect(
      repository.reserveEffect(
        reservation("effect-unknown", fingerprint, 7),
      ),
    ).resolves.toEqual({
      kind: "reconciliation_required",
      status: "unknown",
    });
    await expect(
      repository.reserveEffect(
        reservation("effect-unknown", `sha256:${"f".repeat(64)}`, 7),
      ),
    ).resolves.toEqual({ kind: "conflict" });
    expect(
      repository.effectAuditEvents
        .filter((event) => event.effectRef === "effect-unknown")
        .map((event) => event.eventType),
    ).toEqual(["effect.reserved", "effect.unknown"]);
  });

  it("reconciles unknown outcomes into immutable terminal history", async () => {
    const repository = await setup(20);
    const fingerprint = `sha256:${"7".repeat(64)}`;
    await repository.reserveEffect(
      reservation("effect-reconcile", fingerprint, 7),
    );
    await repository.markEffectUnknown({
      workspaceId: "workspace-1",
      effectRef: "effect-reconcile",
      requestFingerprint: fingerprint,
      failureCode: "PROVIDER_OUTCOME_UNKNOWN",
      now: new Date("2026-07-25T00:00:02.000Z"),
    });
    const reconciliation = {
      workspaceId: "workspace-1",
      effectRef: "effect-reconcile",
      requestFingerprint: fingerprint,
      reconciliationReference: "provider-check-1",
      resolution: {
        kind: "completed" as const,
        safeResult: { providerRequestId: "request-reconciled" },
      },
      now: new Date("2026-07-25T00:00:03.000Z"),
    };
    await expect(repository.reconcileEffect(reconciliation)).resolves.toBe(
      true,
    );
    await expect(repository.reconcileEffect(reconciliation)).resolves.toBe(
      true,
    );
    await expect(
      repository.reconcileEffect({
        ...reconciliation,
        reconciliationReference: "provider-check-drift",
      }),
    ).resolves.toBe(false);
    expect(
      repository.effectAuditEvents
        .filter((event) => event.effectRef === "effect-reconcile")
        .map((event) => event.eventType),
    ).toEqual([
      "effect.reserved",
      "effect.unknown",
      "effect.reconciled",
      "effect.completed",
    ]);
  });

  it("records failed reconciliation and released capacity separately", async () => {
    const repository = await setup(10);
    const fingerprint = `sha256:${"8".repeat(64)}`;
    await repository.reserveEffect(
      reservation("effect-reconcile-failed", fingerprint, 8),
    );
    await expect(
      repository.reconcileEffect({
        workspaceId: "workspace-1",
        effectRef: "effect-reconcile-failed",
        requestFingerprint: fingerprint,
        reconciliationReference: "provider-check-failed",
        resolution: {
          kind: "failed",
          failureCode: "PROVIDER_CONFIRMED_FAILED",
        },
        now: new Date("2026-07-25T00:00:03.000Z"),
      }),
    ).resolves.toBe(true);
    expect(
      (await repository.listSpendGrants("workspace-1"))[0]?.spentCents,
    ).toBe(0);
    expect(
      repository.effectAuditEvents
        .filter((event) => event.effectRef === "effect-reconcile-failed")
        .map((event) => event.eventType),
    ).toEqual([
      "effect.reserved",
      "effect.reconciled",
      "effect.failed",
      "effect.released",
    ]);
  });

  it("uses the server quote ceiling rather than the snapshotted intent amount", async () => {
    const repository = await setup();
    await expect(
      repository.reserveEffect(
        reservation("effect-quote-1", `sha256:${"1".repeat(64)}`, 7),
      ),
    ).resolves.toMatchObject({ kind: "reserved" });
    await expect(
      repository.reserveEffect({
        ...reservation(
          "effect-quote-2",
          `sha256:${"2".repeat(64)}`,
          4,
        ),
        intent: intent("effect-quote-2", 0),
      }),
    ).resolves.toEqual({ kind: "unavailable" });
  });
});
