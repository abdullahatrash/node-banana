import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  exactExecutionGrant,
  normalizePublishingDeliveryConfirmationCap,
  publishingDeliveryReadinessDeadline,
  validRetainedExecutionAdmissionProvenance,
} from "../postgres-repository";

const digest = (value: string) => `sha256:${value.repeat(64)}`;

describe("Publishing Delivery PostgreSQL recovery contracts", () => {
  it("authorizes the complete retained multi-channel release manifest", () => {
    const contractDigest = digest("c");
    const grant = {
      capability: "publishing_plan_revisions.release@1",
      authorizationContractDigest: contractDigest,
      resources: {
        channelIds: ["channel_1", "channel_2"],
        artifactIds: ["artifact_1", "artifact_2"],
        credentialProfileIds: [],
        workflowIds: [],
        automationIds: [],
      },
    };
    const manifest = {
      capability: grant.capability,
      contractDigest,
      channelIds: ["channel_1", "channel_2"],
      artifactIds: ["artifact_1", "artifact_2"],
    };
    expect(exactExecutionGrant([grant], manifest)).toBe(true);
    expect(exactExecutionGrant([{ ...grant, resources: {
      ...grant.resources,
      channelIds: ["channel_1", "channel_2", "channel_3"],
      artifactIds: ["artifact_1", "artifact_2", "artifact_3"],
    } }], manifest)).toBe(true);
    expect(exactExecutionGrant([{ ...grant, resources: {
      ...grant.resources,
      channelIds: ["channel_1"],
    } }], manifest)).toBe(false);
  });

  it("uses historical admission provenance and a fresh readiness window after queue delay", () => {
    const issuedAt = new Date("2026-08-09T10:00:00.000Z");
    const admissionExpiredAt = new Date("2026-08-09T10:15:00.000Z");
    const scheduledExecutionAt = new Date("2026-08-10T10:00:00.000Z");

    expect(validRetainedExecutionAdmissionProvenance({
      issuedAt,
      expiresAt: admissionExpiredAt,
      executionAt: scheduledExecutionAt,
    })).toBe(true);
    expect(validRetainedExecutionAdmissionProvenance({
      issuedAt,
      expiresAt: issuedAt,
      executionAt: scheduledExecutionAt,
    })).toBe(false);
    expect(publishingDeliveryReadinessDeadline(scheduledExecutionAt).getTime() -
      scheduledExecutionAt.getTime()).toBe(10_000);
  });

  it("terminalizes the third automatic observation while retaining the provider reference", () => {
    const base = {
      deliveryId: "pdl_confirmation_cap",
      effectKey: "publishing-effect:v1:workspace_1:pdl_confirmation_cap",
      effectGeneration: 1,
      providerOperationRef: "provider_operation_1",
      sourceEvidenceDigest: digest("a"),
    } as const;

    // Initial 202 is a launch response, not an automatic observation.
    expect(normalizePublishingDeliveryConfirmationCap({
      ...base,
      deliveryState: "dispatching",
      confirmationAttempts: 0,
    })).toBeNull();
    expect(normalizePublishingDeliveryConfirmationCap({
      ...base,
      deliveryState: "confirmation_pending",
      confirmationAttempts: 0,
    })).toBeNull();
    expect(normalizePublishingDeliveryConfirmationCap({
      ...base,
      deliveryState: "confirmation_pending",
      confirmationAttempts: 1,
    })).toBeNull();

    const terminal = normalizePublishingDeliveryConfirmationCap({
      ...base,
      deliveryState: "confirmation_pending",
      confirmationAttempts: 2,
    });
    expect(terminal).toMatchObject({
      kind: "outcome_unknown",
      providerOperationRef: base.providerOperationRef,
      failureCode: "CONFIRMATION_ATTEMPTS_EXHAUSTED",
      confirmationAttempts: 3,
    });
    expect(terminal?.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("keeps retry/reconciliation evidence append-only and confirmation exhaustion atomic", async () => {
    const migration = await readFile(
      "drizzle/0050_runtime_publishing_delivery_recovery.sql",
      "utf8",
    );
    for (const trigger of [
      "runtime_publishing_delivery_effect_receipts_insert_only",
      "runtime_publishing_delivery_readiness_receipts_insert_only",
      "runtime_publishing_delivery_retry_receipts_insert_only",
      "runtime_publishing_delivery_reconciliation_requests_insert_only",
      "runtime_publishing_delivery_reconciliation_receipts_insert_only",
      "runtime_publishing_delivery_effect_identity_seal_complete",
      "runtime_publishing_delivery_reconciliation_result_complete",
      "runtime_publishing_delivery_reconciled_transition_complete",
    ]) expect(migration).toContain(trigger);
    expect(migration).toContain("NEW.confirmation_attempts <> 3");
    expect(migration).toContain("NEW.provider_operation_ref IS NULL");
    expect(migration).toContain(
      "NEW.next_outbox_generation <> OLD.next_outbox_generation",
    );
    expect(migration).toContain(
      "Publishing Delivery reconciliation result is incomplete or inconsistent",
    );
    expect(migration).toContain(
      "Publishing Delivery reconciled transition requires its immutable result receipt",
    );
    expect(migration).toContain("THEN 'failed_transient'");
    expect(migration).toContain("THEN 'failed_terminal'");
    expect(migration).toContain(
      "effect.failure_retryable IS NOT DISTINCT FROM NEW.failure_retryable",
    );
    expect(migration).toContain("effect_attempt\" between 1 and 8");
    expect(migration).toContain("derivation\" = 'manual_retry'");
    expect(migration).toContain("source_failure_class\" in ('transient','terminal')");
    expect(migration).not.toContain("result_effect_generation");
    expect(migration).not.toContain("result_effect_key");
    expect(migration).toContain(
      "manual retry creates a child Delivery",
    );
    expect(migration).toContain("delivery_retry_id IS NOT NULL");
    expect(migration).toContain("NEW.type = 'delivery.retry_requested'");
    expect(migration).toContain("next_sequence = 4 AND NEW.sequence = 3");
    expect(migration).toContain(
      "Retry-origin Delivery requires exact accepted, retry-requested, and scheduled evidence",
    );
    expect(migration).toContain(
      'USING btree ("workspace_id","delivery_id","source_evidence_digest")',
    );
  });

  it("ships one upgrade-safe 0050 with exact recovery identities and global Approval single-use", async () => {
    const migration = await readFile(
      "drizzle/0050_runtime_publishing_delivery_recovery.sql",
      "utf8",
    );
    for (const idCheck of [
      "^pdrt_[A-Za-z0-9_-]+$",
      "^pdrc_[A-Za-z0-9_-]+$",
      "^pdre_[A-Za-z0-9_-]+$",
    ]) expect(migration).toContain(idCheck);
    expect(migration).toContain(
      "runtime_publishing_approval_global_single_use_guard",
    );
    expect(migration).toContain(
      "runtime_publishing_delivery_retry_receipts_invocation_unique",
    );
    expect(migration).toContain(
      'UPDATE "runtime_publishing_deliveries" AS delivery',
    );
    expect(migration).toContain(
      "0050 cannot backfill Delivery Approval requester provenance",
    );
    expect(migration).toContain(
      'ALTER COLUMN "requesting_principal_id" SET NOT NULL',
    );
    expect(migration).toContain(
      "runtime_publishing_deliveries_origin_check",
    );
    expect(migration).toContain(
      "runtime_publishing_delivery_retry_origin_guard",
    );
    expect(migration).toContain(
      "runtime_publishing_deliveries_retry_origin_guard",
    );
    expect(migration).toContain(
      "runtime_publishing_delivery_retry_receipts_origin_guard",
    );
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain("runtime_publishing_approval_retry_sources");
    expect(migration).toContain(
      "runtime_publishing_approval_retry_sources_delivery_fk",
    );
    expect(migration).not.toContain(
      "runtime_publishing_delivery_reconciliation_receipts_request_idx",
    );
    const suspendedIdentity = migration.indexOf(
      'DROP TRIGGER "runtime_publishing_deliveries_identity_immutable"',
    );
    const firstDeliveryBackfill = migration.indexOf(
      'UPDATE "runtime_publishing_deliveries"',
    );
    const restoredIdentity = migration.lastIndexOf(
      'CREATE TRIGGER "runtime_publishing_deliveries_identity_immutable"',
    );
    expect(suspendedIdentity).toBeGreaterThanOrEqual(0);
    expect(suspendedIdentity).toBeLessThan(firstDeliveryBackfill);
    expect(restoredIdentity).toBeGreaterThan(firstDeliveryBackfill);
    expect(migration).toContain(
      'DROP TRIGGER "runtime_publishing_delivery_events_insert_only"',
    );
    expect(migration).toContain(
      'DROP TRIGGER "runtime_publishing_delivery_cancellations_insert_only"',
    );

    const journal = await readFile("drizzle/meta/_journal.json", "utf8");
    expect(journal).toContain("0050_runtime_publishing_delivery_recovery");
    expect(journal).not.toContain("0051_familiar_ares");
    expect(journal).not.toContain("0052_elite_mimic");
    expect(journal).not.toContain("0053_superb_doomsday");
  });

  it("rechecks the retained retry actor and current evidence immediately before contact", async () => {
    const source = await readFile(
      "src/lib/agent-runtime/publishing-deliveries/postgres-repository.ts",
      "utf8",
    );
    const recoveryStart = source.indexOf("async function lockRecoveryAuthorization");
    const readinessStart = source.indexOf("async function evaluateExecutionReadiness");
    const releaseStart = source.indexOf("async function lockReleaseAuthorization");
    const cancellationStart = source.indexOf("function cancellationAuthorityDigest");
    const release = source.slice(releaseStart, cancellationStart);
    const recovery = source.slice(recoveryStart, readinessStart);
    for (const marker of [
      "session.actor.principalId",
      "session.actor.keyId",
      "session.capability",
      "agentGrantSets.activeRevision",
      "row.key.authorizationScopes",
      "row.policy.enabled",
      "row.policyRevision.enabled",
      "exactExecutionGrant(row.key.authorizationScopes, recoveryGrantInput)",
      "sameOrder(channelIds, [delivery.channelId])",
      "sameSet(artifactIds, delivery.artifactIds)",
    ]) expect(recovery).toContain(marker);

    const readiness = source.slice(readinessStart,
      source.indexOf("export class DrizzlePublishingDeliveryExecutionReadinessRepository"));
    expect(readiness).toContain("lockRecoveryAuthorization(tx, retryAuthorization, retrySource");
    expect(readiness).toContain("lockRetainedPublishingApprovalRevision(tx, currentApproval)");
    expect(readiness).toContain("publishingDeliveryReadinessDeadline(now)");
    expect(readiness).toContain("verifyCurrentPublishingPlanEvidence(");
    expect(readiness).toContain("{ allowDuePublishAt: true }");
    expect(readiness).not.toContain("approval.request.decisionPolicyExpiresAt <= now");
    expect(readiness).not.toContain("new Date(currentApproval.validation.expiresAt)");
    expect(release).not.toContain("session.expiresAt <= at");
    expect(release).toContain("row.key.expiresAt && row.key.expiresAt <= at");
    expect(release).toContain("exactExecutionGrant(row.grantRevision.grants, grantInput)");
    expect(recovery).not.toContain("session.expiresAt <= at");
    expect(recovery).toContain("row.key.expiresAt && row.key.expiresAt <= at");
    expect(recovery).toContain("row.grant.expiresAt && row.grant.expiresAt <= at");
    const approvalSource = await readFile(
      "src/lib/agent-runtime/publishing-approvals/postgres-repository.ts",
      "utf8",
    );
    expect(approvalSource).toContain("runtimeSpendControls");
    expect(approvalSource).toContain("artifact.deletedAt !== null");
    const retainedRevision = approvalSource.slice(
      approvalSource.indexOf("export async function lockRetainedPublishingApprovalRevision"),
      approvalSource.indexOf("export async function verifyCurrentPublishingPlanEvidence"),
    );
    expect(retainedRevision).not.toContain("runtimePublishingPlans");
  });

  it("queries release and retry Delivery origins without broadening principal visibility", async () => {
    const source = await readFile(
      "src/lib/agent-runtime/publishing-deliveries/postgres-repository.ts",
      "utf8",
    );
    const getStart = source.indexOf("async getDelivery(");
    const listEnd = source.indexOf("async listEvents(", getStart);
    const queries = source.slice(getStart, listEnd);
    expect(queries).toContain(".leftJoin(\n      runtimePublishingDeliveryReleases");
    expect(queries).toContain("runtimePublishingDeliveryRetryReceipts.id");
    expect(queries).toContain("runtimePublishingDeliveryRetryReceipts.deliveryId");
    expect(queries).toContain("runtimePublishingDeliveries.requestingPrincipalId");
    expect(queries).toContain("runtimePublishingDeliveryRetryReceipts.actorKind, \"agent\"");
    expect(queries).toContain("runtimePublishingDeliveryRetryReceipts.principalId");
    expect(queries).not.toContain(".innerJoin(\n      runtimePublishingDeliveryReleases");
  });

  it("serializes reconciliation globally and rejects a different actor replay", async () => {
    const source = await readFile(
      "src/lib/agent-runtime/publishing-deliveries/postgres-repository.ts",
      "utf8",
    );
    const requestStart = source.indexOf("async requestReconciliation(");
    const claimStart = source.indexOf("async claimOutbox(", requestStart);
    const request = source.slice(requestStart, claimStart);
    expect(request).toContain("publishing-delivery-reconciliation:");
    expect(request).toContain("pg_advisory_xact_lock");
    expect(request).toContain('kind: "reconciliation_conflict"');
    const priorQuery = request.slice(request.indexOf("const priorRows"),
      request.indexOf(")).limit(1).for(\"update\")") + 32);
    expect(priorQuery).not.toContain("actorKind");
    expect(priorQuery).not.toContain("actorId");
  });

  it("rejects exhausted reconciliation before another request or lease", async () => {
    const source = await readFile(
      "src/lib/agent-runtime/publishing-deliveries/postgres-repository.ts",
      "utf8",
    );
    const request = source.slice(
      source.indexOf("async requestReconciliation("),
      source.indexOf("async claimOutbox("),
    );
    const acquire = source.slice(
      source.indexOf("async acquireReconciliationLease("),
      source.indexOf("async settleReconciliation("),
    );
    expect(request).toContain("publishingDeliveryReconciliationExhausted(delivery)");
    expect(request.indexOf("publishingDeliveryReconciliationExhausted(delivery)")).toBeLessThan(
      request.indexOf("tx.insert(runtimePublishingDeliveryReconciliationRequests)"),
    );
    expect(acquire).toContain("publishingDeliveryReconciliationExhausted(delivery)");
    expect(acquire.indexOf("publishingDeliveryReconciliationExhausted(delivery)")).toBeLessThan(
      acquire.indexOf("runtimePublishingDeliveryExecutionLeases"),
    );
  });

  it("advances the receipt attempt when expired contact becomes unknown", async () => {
    const source = await readFile(
      "src/lib/agent-runtime/publishing-deliveries/postgres-repository.ts",
      "utf8",
    );
    const acquire = source.slice(
      source.indexOf("async acquireLease("),
      source.indexOf("async renewLease("),
    );
    const recovery = acquire.slice(
      acquire.indexOf("publishing-delivery-contact-recovery-evidence/v1"),
      acquire.indexOf("delivery.desiredState === \"cancel\""),
    );
    expect(recovery).toContain(
      "nextEffectAttempt: Math.min(9, delivery.nextEffectAttempt + 1)",
    );
  });

  it("keeps the production retry method on the guarded child bootstrap path", async () => {
    const source = await readFile(
      "src/lib/agent-runtime/publishing-deliveries/postgres-repository.ts",
      "utf8",
    );
    const retry = source.slice(
      source.indexOf("async retryKnownFailure("),
      source.indexOf("async getReconciliation("),
    );
    const childInsert = retry.indexOf("tx.insert(runtimePublishingDeliveries)");
    const eventInsert = retry.indexOf("tx.insert(runtimePublishingDeliveryEvents)");
    const receiptInsert = retry.indexOf("tx.insert(runtimePublishingDeliveryRetryReceipts)");
    expect(childInsert).toBeGreaterThan(-1);
    expect(eventInsert).toBeGreaterThan(childInsert);
    expect(receiptInsert).toBeGreaterThan(eventInsert);
    expect(retry).toContain('child.nextEventSequence !== 4');
    expect(retry).toContain('retryEvent.sequence !== 2');
    expect(retry).toContain('scheduledEvent.sequence !== 3');
  });

  it("checks exhausted attempts before contact writes and allocates reconciliation attempts monotonically", async () => {
    const source = await readFile(
      "src/lib/agent-runtime/publishing-deliveries/postgres-repository.ts",
      "utf8",
    );
    const begin = source.slice(source.indexOf("async beginEffectContact("),
      source.indexOf("async failBeforeEffect("));
    expect(begin.indexOf("nextEffectAttempt > 8")).toBeGreaterThan(-1);
    expect(begin.indexOf("nextEffectAttempt > 8")).toBeLessThan(
      begin.indexOf("runtimePublishingDeliveryEvents).values"),
    );
    const reconcile = source.slice(source.indexOf("async settleReconciliation("));
    expect(reconcile).not.toContain("Math.min(8, Math.max(1");
    expect(reconcile).toContain(
      "effectAttempt: deliveryRows[0]!.nextEffectAttempt",
    );
    expect(reconcile).toContain("RECONCILIATION_ATTEMPTS_EXHAUSTED");
  });
});
