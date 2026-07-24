import { describe, expect, it } from "vitest";
import { CredentialVaultService, CredentialVaultError } from "../service";
import { InMemoryCredentialVaultRepository } from "../memory-repository";

const cipher = {
  encrypt: (value: string) => value,
  decrypt: (value: string) => value,
};

function ledgerEvent(
  id: string,
  workspaceId: string,
  eventType:
    | "effect.reserved"
    | "effect.completed"
    | "effect.failed"
    | "effect.unknown"
    | "effect.reconciled"
    | "effect.released"
    | "effect.replayed",
  createdAt: Date,
  effectSequence = 1,
) {
  return {
    id,
    workspaceId,
    principalId: "principal-1",
    profileId: "profile-1",
    versionId: "version-1",
    spendGrantId: "grant-1",
    effectRef: `effect-${id}`,
    effectSequence,
    eventType,
    requestFingerprint: `sha256:${id.padEnd(64, "0")}`,
    failureCode:
      eventType === "effect.failed" || eventType === "effect.released"
        ? "PROVIDER_NOT_STARTED"
        : eventType === "effect.unknown"
          ? "PROVIDER_OUTCOME_UNKNOWN"
          : null,
    reconciliationReference: null,
    createdAt,
  };
}

describe("unified Credential audit pagination", () => {
  it("exports safe durable effect outcomes through a bounded opaque cursor", async () => {
    const repository = new InMemoryCredentialVaultRepository();
    repository.effectAuditEvents.push(
      ledgerEvent("a", "workspace-1", "effect.released", new Date("2026-07-24T03:00:00Z")),
      ledgerEvent("b", "workspace-1", "effect.unknown", new Date("2026-07-24T02:00:00Z")),
      ledgerEvent(
        "c",
        "workspace-1",
        "effect.completed",
        new Date("2026-07-24T01:00:00Z"),
      ),
      ledgerEvent("d", "workspace-2", "effect.completed", new Date("2026-07-24T04:00:00Z")),
    );
    const vault = new CredentialVaultService(repository, cipher);

    const first = await vault.listAuditEvents({
      workspaceId: "workspace-1",
      limit: 2,
    });
    expect(first.events).toMatchObject([
      {
        workspaceId: "workspace-1",
        eventType: "effect.released",
        outcome: "released",
        reason: "PROVIDER_NOT_STARTED",
        correlationRef: expect.stringMatching(/^sha256:/),
        idempotencyKey: "effect-a",
        effectRef: "effect-a",
      },
      {
        workspaceId: "workspace-1",
        eventType: "effect.unknown",
        outcome: "unknown",
      },
    ]);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.nextCursor).not.toContain("effect-b");

    const second = await vault.listAuditEvents({
      workspaceId: "workspace-1",
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second).toMatchObject({
      events: [
        {
          eventType: "effect.completed",
          outcome: "succeeded",
          idempotencyKey: "effect-c",
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify({ first, second })).not.toMatch(
      /secret|ciphertext|safeResult|predictionId/i,
    );
  });

  it("rejects malformed and cross-Workspace cursors", async () => {
    const repository = new InMemoryCredentialVaultRepository();
    repository.effectAuditEvents.push(
      ledgerEvent("a", "workspace-1", "effect.reserved", new Date("2026-07-24T03:00:00Z")),
      ledgerEvent("b", "workspace-1", "effect.reserved", new Date("2026-07-24T02:00:00Z")),
    );
    const vault = new CredentialVaultService(repository, cipher);
    const page = await vault.listAuditEvents({
      workspaceId: "workspace-1",
      limit: 1,
    });

    await expect(
      vault.listAuditEvents({
        workspaceId: "workspace-2",
        cursor: page.nextCursor!,
      }),
    ).rejects.toBeInstanceOf(CredentialVaultError);
    await expect(
      vault.listAuditEvents({
        workspaceId: "workspace-1",
        cursor: "not-a-cursor",
      }),
    ).rejects.toBeInstanceOf(CredentialVaultError);
  });

  it("keeps cursor pagination stable when lifecycle timestamps collide", async () => {
    const repository = new InMemoryCredentialVaultRepository();
    const timestamp = new Date("2026-07-24T03:00:00Z");
    repository.effectAuditEvents.push(
      {
        ...ledgerEvent(
          "a",
          "workspace-1",
          "effect.reserved",
          timestamp,
          1,
        ),
        effectRef: "effect-shared",
      },
      {
        ...ledgerEvent(
          "b",
          "workspace-1",
          "effect.completed",
          timestamp,
          2,
        ),
        effectRef: "effect-shared",
      },
      {
        ...ledgerEvent(
          "c",
          "workspace-1",
          "effect.replayed",
          timestamp,
          3,
        ),
        effectRef: "effect-shared",
      },
    );
    const vault = new CredentialVaultService(repository, cipher);

    const first = await vault.listAuditEvents({
      workspaceId: "workspace-1",
      limit: 2,
    });
    const second = await vault.listAuditEvents({
      workspaceId: "workspace-1",
      limit: 2,
      cursor: first.nextCursor!,
    });

    expect([
      ...first.events.map((event) => event.id),
      ...second.events.map((event) => event.id),
    ]).toEqual(["c", "b", "a"]);
    expect(
      [...first.events, ...second.events].map(
        (event) => event.effectSequence,
      ),
    ).toEqual([3, 2, 1]);
  });
});
