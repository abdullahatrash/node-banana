import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  rehydratePublishingDelivery,
  rehydratePublishingDeliveryCancellation,
  rehydratePublishingDeliveryEvent,
  rehydratePublishingDeliveryOutbox,
} from "../postgres-repository";
import { publishingDeliveryCancelAuthorizationContractDigest } from
  "../authorization-contract";
import { setupPublishingDeliveries } from "./fixtures";

async function deliveryRow(punctuatedArtifacts = false) {
  const fixture = await setupPublishingDeliveries(undefined, { punctuatedArtifacts });
  const accepted = await fixture.service.release(fixture.releaseInput());
  const delivery = await fixture.repository.getDelivery({
    workspaceId: "workspace_1",
    deliveryId: accepted.deliveries[0]!.id,
  });
  if (!delivery) throw new Error("fixture delivery missing");
  return {
    ...delivery,
    targetOrdinal: 0,
    validationEvidenceDigest: fixture.rawApproval.validation.evidenceDigest,
  };
}

describe("Drizzle Publishing Delivery rehydration", () => {
  it("accepts canonical punctuated Artifact IDs and exact lifecycle state", async () => {
    const row = await deliveryRow(true);
    expect(rehydratePublishingDelivery(row)).toMatchObject({
      artifactIds: ["artifact:text.v1", "artifact:image.v1"],
      state: "scheduled",
      nextOutboxGeneration: 2,
    });
  });

  it("rehydrates the full Publishing Plan artifact bound", async () => {
    const row = await deliveryRow();
    const content = row.targetSnapshot.validation.artifacts[0]!;
    const image = row.targetSnapshot.validation.artifacts[1]!;
    const mediaArtifactIds = Array.from(
      { length: 50 },
      (_, index) => `artifact:image.${index + 1}`,
    );
    const target = {
      ...row.targetSnapshot.target,
      mediaArtifactIds,
    };
    const validation = {
      ...row.targetSnapshot.validation,
      artifacts: [
        content,
        ...mediaArtifactIds.map((id) => ({ ...image, id })),
      ],
    };
    const targetSnapshot = {
      ...row.targetSnapshot,
      target,
      validation,
      targetDigest: canonicalDigest({ target, validation }),
    };
    expect(rehydratePublishingDelivery({
      ...row,
      artifactIds: [target.contentArtifactId, ...mediaArtifactIds],
      targetSnapshot,
      targetSnapshotDigest: canonicalDigest(targetSnapshot),
    })?.artifactIds).toHaveLength(51);
  });

  it("fails closed for impossible lifecycle combinations", async () => {
    const row = await deliveryRow();
    expect(rehydratePublishingDelivery({
      ...row,
      providerOperationRef: "secret-provider-ref",
    })).toBeNull();
    expect(rehydratePublishingDelivery({
      ...row,
      nextOutboxGeneration: 1,
    })).toBeNull();
  });

  it("fails closed for self-consistent but invalid target evidence", async () => {
    const row = await deliveryRow();
    const validation = {
      ...row.targetSnapshot.validation,
      settingsDigest: `sha256:${"f".repeat(64)}`,
    };
    const targetSnapshot = {
      ...row.targetSnapshot,
      validation,
      targetDigest: canonicalDigest({
        target: row.targetSnapshot.target,
        validation,
      }),
    };
    expect(rehydratePublishingDelivery({
      ...row,
      targetSnapshot,
      targetSnapshotDigest: canonicalDigest(targetSnapshot),
    })).toBeNull();
  });

  it("rejects event evidence with extra or malformed fields", () => {
    const base = {
      workspaceId: "workspace_1",
      id: "pde_1",
      deliveryId: "pdl_1",
      sequence: 3,
      type: "effect.prepared",
      evidence: {
        effectKey: "publishing-effect:v1:workspace_1:pdl_1",
        intentDigest: `sha256:${"a".repeat(64)}`,
      },
      occurredAt: new Date("2026-08-08T12:00:00.000Z"),
    } as const;
    expect(rehydratePublishingDeliveryEvent(base)).not.toBeNull();
    expect(rehydratePublishingDeliveryEvent({
      ...base,
      evidence: { ...base.evidence, token: "must-not-leak" },
    } as unknown as Parameters<typeof rehydratePublishingDeliveryEvent>[0])).toBeNull();
  });

  it("rejects malformed outbox lifecycle and noncanonical generations", () => {
    const base = {
      id: "pdo_1",
      workspaceId: "workspace_1",
      deliveryId: "pdl_1",
      dedupeKey: "publishing-delivery:workspace_1:pdl_1:v1",
      generation: 1,
      state: "pending",
      availableAt: new Date("2026-08-08T12:00:00.000Z"),
      deliveryToken: null,
      deliveryAttempts: 0,
      claimedAt: null,
      deliveredAt: null,
    } as const;
    expect(rehydratePublishingDeliveryOutbox(base)).not.toBeNull();
    expect(rehydratePublishingDeliveryOutbox({
      ...base,
      dedupeKey: "publishing-delivery:workspace_1:pdl_1:v4",
    })).toBeNull();
    expect(rehydratePublishingDeliveryOutbox({
      ...base,
      state: "claimed",
      deliveryToken: null,
    })).toBeNull();
  });

  it("fails closed on noncanonical retained cancellation authority", () => {
    const authorizationIssuedAt = new Date("2026-08-09T10:00:00.000Z");
    const authorizationExpiresAt = new Date("2026-08-09T10:15:00.000Z");
    const authorizedResources = {
      channelIds: ["channel_1"],
      artifactIds: ["artifact:text.v1"],
    };
    const authorizationEvidenceDigest = canonicalDigest({
      schema: "publishing-delivery-cancellation-authority-evidence/v1",
      workspaceId: "workspace_1",
      actor: { kind: "agent", principalId: "principal_1", keyId: "key_1" },
      capability: "publishing_deliveries.cancel@1",
      contractDigest: publishingDeliveryCancelAuthorizationContractDigest(),
      admissionEvidenceRef: "otr_cancel_1",
      evidenceRef: "otr_cancel_1",
      resources: authorizedResources,
      humanGrants: [],
      issuedAt: authorizationIssuedAt.toISOString(),
      expiresAt: authorizationExpiresAt.toISOString(),
    });
    const row: Parameters<typeof rehydratePublishingDeliveryCancellation>[0] = {
      workspaceId: "workspace_1",
      id: "pdc_1",
      deliveryId: "pdl_1",
      actorKind: "agent",
      actorId: "principal_1",
      principalId: "principal_1",
      keyId: "key_1",
      userId: null,
      capability: "publishing_deliveries.cancel@1",
      authorizationSessionId:
        `pdcas_${authorizationEvidenceDigest.slice("sha256:".length)}`,
      authorizationContractDigest:
        publishingDeliveryCancelAuthorizationContractDigest(),
      authorizationAdmissionEvidenceRef: "otr_cancel_1",
      authorizationEvidenceRef: "otr_cancel_1",
      authorizationEvidenceDigest,
      authorizedResources,
      authorityGrants: [],
      authorizationIssuedAt,
      authorizationExpiresAt,
      stateAtRequest: "scheduled",
      outcome: "prevented",
      externallyCompletedAtRequest: false,
      externallyReversed: false,
      requestedAt: new Date("2026-08-09T10:01:00.000Z"),
    };
    expect(rehydratePublishingDeliveryCancellation(row)).not.toBeNull();
    expect(rehydratePublishingDeliveryCancellation({
      ...row,
      authorizationContractDigest: `sha256:${"f".repeat(64)}`,
    })).toBeNull();
    expect(rehydratePublishingDeliveryCancellation({
      ...row,
      authorizationEvidenceDigest: `sha256:${"e".repeat(64)}`,
    })).toBeNull();
    expect(rehydratePublishingDeliveryCancellation({
      ...row,
      authorizationSessionId: "pdcas_wrong",
    })).toBeNull();
  });
});
