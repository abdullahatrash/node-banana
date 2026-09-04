import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/renderWithIntl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryOperationsResultMap } from "@/lib/studio/client";
import { DeliveryOperationsCockpit } from "./DeliveryOperationsCockpit";

const digest = (value: string) => `sha256:${value.repeat(64)}`;

type Delivery = DeliveryOperationsResultMap["publishing_deliveries.get@2"]["delivery"];

function delivery(state: Delivery["state"] = "outcome_unknown"): Delivery {
  const publishAt = "2026-08-09T12:00:00.000Z";
  return {
    id: "delivery_1",
    workspaceId: "workspace_1",
    sourceDeliveryId: null,
    retryId: null,
    releaseId: "release_1",
    planId: "plan_1",
    planRevisionId: "revision_1",
    planRevision: 7,
    planRevisionDigest: digest("a"),
    approvalRequestId: "approval_1",
    approvalDecisionId: "decision_1",
    requestingPrincipalId: "principal_1",
    requestingKeyId: "key_1",
    targetId: "target_1",
    channelId: "channel_1",
    artifactIds: ["artifact_text"],
    targetSnapshot: {
      schema: "publishing-delivery-target-snapshot/v1",
      target: {
        targetId: "target_1",
        channelId: "channel_1",
        contentArtifactId: "artifact_text",
        mediaArtifactIds: [],
        settings: { type: "person" },
        timing: { kind: "scheduled", publishAt },
      },
      validation: {
        targetId: "target_1",
        channel: {
          id: "channel_1",
          platform: "linkedin",
          authorKind: "person",
          snapshotDigest: digest("b"),
          capabilityVersion: digest("c"),
        },
        artifacts: [{
          id: "artifact_text",
          digest: digest("d"),
          snapshotDigest: digest("e"),
          kind: "text",
          mediaType: "text/plain; charset=utf-8",
          sizeBytes: 12,
        }],
        settingsDigest: digest("f"),
        publishAt,
        policyEvidenceDigest: digest("1"),
        policyStateDigest: digest("2"),
        blockerCodes: [],
      },
      targetDigest: digest("3"),
    },
    targetSnapshotDigest: digest("3"),
    publishAt,
    desiredState: "publish",
    state,
    effectKey: "publishing-effect:v1:workspace_1:delivery_1",
    effectGeneration: 1,
    intentDigest: state === "scheduled" ? null : digest("4"),
    providerAdapterContractDigest: state === "scheduled" ? null : digest("5"),
    nextEffectAttempt: 2,
    providerOperationRef: state === "outcome_unknown" ? "provider_operation_1" : null,
    latestEffectEvidenceDigest: state === "outcome_unknown" ? digest("6") : null,
    failureCode: state === "outcome_unknown" ? "PROVIDER_TIMEOUT" : null,
    failureClass: null,
    failureRetryable: null,
    failureEffectDisposition: state === "outcome_unknown" ? "ambiguous" : null,
    readinessBlockCode: null,
    readinessEvidenceDigest: null,
    readinessBlockedAt: null,
    readinessRetryAt: null,
    readinessBlockCount: 0,
    nextEventSequence: 3,
    nextOutboxGeneration: 2,
    acceptedAt: "2026-08-09T11:00:00.000Z",
    scheduledAt: "2026-08-09T11:00:00.000Z",
    dispatchStartedAt: state === "scheduled" ? null : "2026-08-09T12:00:00.000Z",
    effectContactStartedAt: state === "scheduled" ? null : "2026-08-09T12:00:01.000Z",
    completedAt: state === "outcome_unknown" ? "2026-08-09T12:00:02.000Z" : null,
    updatedAt: "2026-08-09T12:00:02.000Z",
    externallyCompleted: state === "outcome_unknown" ? null : false,
  };
}

function cancellation(outcome: "prevented" | "conditional" | "unknown" | "too_late") {
  return {
    schema: "publishing-delivery-cancellation/v1" as const,
    cancellationId: "cancellation_1",
    deliveryId: "delivery_1",
    desiredState: "cancel" as const,
    stateAtRequest: outcome === "prevented" ? "scheduled" as const : "dispatching" as const,
    outcome,
    externallyCompletedAtRequest: outcome === "prevented" ? false : outcome === "too_late" ? true : null,
    requestedAt: "2026-08-09T12:00:03.000Z",
    durable: true as const,
    externallyReversed: false as const,
  };
}

type Wait = DeliveryOperationsResultMap["quota_waits.list@1"]["items"][number];

function quotaWait(state: Wait["state"] = "waiting"): Wait {
  const resumed = state === "resumed";
  return {
    schema: "quota-wait/v1",
    id: "wait_1",
    workspaceId: "workspace_1",
    admittedPrincipalId: "principal_1",
    runId: "run_wait_1",
    transitionKey: "run_wait_1:admission",
    boundary: "run_admission",
    subject: { kind: "run", id: "run_wait_1" },
    claims: [{ dimension: "run.concurrent@1", unit: "count", amount: "1" }],
    reasonCode: "QUOTA_RENEWABLE_CAPACITY_EXHAUSTED",
    evidence: [{
      schema: "quota-exhaustion-evidence/v1",
      policyId: "quota_policy_1",
      policyRevisionId: "quota_revision_1",
      scope: "principal",
      dimension: "run.concurrent@1",
      unit: "count",
      window: { kind: "concurrent", timezone: "UTC", startsAt: "2026-08-09T12:00:00.000Z", endsAt: null },
      hardLimit: "2",
      committed: "2",
      requested: "1",
      available: "0",
      blockingReservationIds: ["quota_reservation_1"],
      evaluatedAt: "2026-08-09T12:00:02.000Z",
      eligibleAt: null,
      eligibility: { kind: "capacity_release", requiredAvailable: "1" },
      evidenceRef: "quota_evidence_1",
      evidenceVersion: 1,
    }],
    eligibleAt: null,
    state,
    resumeReason: resumed ? "capacity_available" : null,
    resumedBy: resumed ? { kind: "human", userId: "owner_1" } : null,
    resumeIdempotencyKey: resumed ? "quota-wait-wait_1-key" : null,
    resolutionReservationIds: resumed ? ["quota_reservation_2"] : [],
    createdAt: "2026-08-09T12:00:02.000Z",
    resolvedAt: resumed ? "2026-08-09T12:00:06.000Z" : null,
  };
}

function response(result: unknown, status = 200) {
  return new Response(JSON.stringify(status < 400
    ? { success: true, result }
    : result), { status, headers: { "content-type": "application/json" } });
}

function related(capability: string) {
  if (capability === "publishing_plan_revisions.get@2") return {
    id: "revision_1", workspaceId: "workspace_1", planId: "plan_1", revision: 7,
    definitionDigest: digest("a"), definition: { schema: "publishing-plan-definition/v1", targets: [] },
    validationEvidence: { schema: "publishing-plan-validation-evidence/v1", targets: [] },
    author: { principalId: "principal_1", keyId: "key_1", creationAuthorizationEvidenceRef: "auth_plan_1" },
    createdAt: "2026-08-09T11:00:00.000Z",
  };
  if (capability === "publishing_approvals.get@2") return {
    projection: "human", approval: {
      id: "approval_1", status: "consumed", inspectionDigest: digest("7"),
      decision: { decision: "approved" }, consumption: { consumed: true },
    },
  };
  if (capability === "budget_policies.get_effective@1") return { schema: "effective-budget-policy-list/v1", items: [] };
  if (capability === "budget_reservations.list@1") return {
    schema: "budget-reservation-list/v1",
    items: [{ id: "budget_1", runId: "run_1", policyRevisionId: "budget_revision_1", period: { kind: "calendar_month", timezone: "UTC", startsAt: "2026-08-01T00:00:00.000Z", endsAt: "2026-09-01T00:00:00.000Z" }, state: "held_unknown_cost", reservedAmount: "4.00", heldAmount: "4.00", settledAmount: "0", releasedAmount: "0", currency: "USD" }],
  };
  if (capability === "budget_status.get@1") return {
    schema: "budget-status/v1", workspaceId: "workspace_1", principalId: "principal_1",
    evaluatedAt: "2026-08-09T12:00:02.000Z", items: [{
      scope: "principal", policyId: "budget_policy_1", policyRevisionId: "budget_revision_1",
      currency: "USD", period: { kind: "calendar_month", timezone: "UTC", startsAt: "2026-08-01T00:00:00.000Z", endsAt: "2026-09-01T00:00:00.000Z" },
      warningThreshold: "8.00", hardLimit: "10.00", committed: "9.00", available: "1.00",
      warningState: "warning", certainty: "contains_unknown_cost", unknownReservationCount: 1,
    }],
  };
  if (capability === "quota_policies.get_effective@1") return { schema: "effective-quota-capacity-list/v1", items: [] };
  if (capability === "quota_reservations.list@1") return { schema: "quota-reservation-list/v1", items: [] };
  if (capability === "quota_waits.list@1") return { schema: "quota-wait-list/v1", items: [] };
  if (capability === "spend_controls.get@2") return {
    schema: "workspace-spend-control/v2", workspaceId: "workspace_1", suspended: false,
    revision: 1, reason: "Normal operations", actorUserId: "owner_1",
    recordedAt: "2026-08-09T10:00:00.000Z", policyEventId: "spend_event_1",
    authorizationEvidenceRef: "auth_spend_1",
  };
  throw new Error(`Unhandled related capability ${capability}`);
}

interface FetchOptions {
  state?: Delivery["state"];
  cancellationOutcome?: "prevented" | "conditional" | "unknown" | "too_late";
  staleOnAction?: boolean;
  cancelDenied?: boolean;
  eventAuthLoss?: boolean;
  spendDenied?: boolean;
  concurrentEvent?: boolean;
  quotaWait?: boolean;
  waitDenied?: boolean;
  quotaDeniedAfterReload?: boolean;
  futureDispatching?: boolean;
  membershipLostAfterWaitDenial?: boolean;
  spendMutationDenied?: boolean;
  membershipLostAfterSpendDenial?: boolean;
  bootstrapTransition?: boolean;
}

function installFetch(options: FetchOptions = {}) {
  const calls: Array<{ capability: string; input: Record<string, unknown> }> = [];
  let getCount = 0;
  let eventCount = 0;
  let waitResumed = false;
  let waitMutationAttempted = false;
  let spendMutationAttempted = false;
  let bootstrapEventsObserved = false;
  const quotaReadCounts = new Map<string, number>();
  let spendEvidence = related("spend_controls.get@2") as DeliveryOperationsResultMap["spend_controls.get@2"];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { capability: string; input: Record<string, unknown> };
    calls.push(body);
    if (body.capability === "publishing_deliveries.get@2") {
      getCount += 1;
      if ((options.membershipLostAfterWaitDenial && waitMutationAttempted) ||
          (options.membershipLostAfterSpendDenial && spendMutationAttempted)) {
        return response({ success: false, error: "Membership was revoked." }, 403);
      }
      const base = delivery(options.state ?? "outcome_unknown");
      const current = options.bootstrapTransition && bootstrapEventsObserved
        ? { ...base, state: "blocked" as const, updatedAt: "2026-08-09T12:01:00.000Z" }
        : options.futureDispatching
        ? { ...base, state: "dispatching" as const, effectContactStartedAt: null }
        : base;
      if ((options.staleOnAction || options.concurrentEvent) && getCount > 1) {
        return response({ schema: "publishing-delivery-inspection/v2", delivery: { ...current, state: "blocked", updatedAt: "2026-08-09T12:01:00.000Z" }, cancellation: null });
      }
      return response({ schema: "publishing-delivery-inspection/v2", delivery: current, cancellation: options.cancellationOutcome ? cancellation(options.cancellationOutcome) : null });
    }
    if (body.capability === "publishing_delivery_events.list@2") {
      eventCount += 1;
      bootstrapEventsObserved = true;
      if (options.eventAuthLoss && eventCount > 1) return response({ success: false, error: "No access." }, 403);
      return response({ schema: "publishing-delivery-event-page/v1", items: body.input.afterSequence
        ? options.concurrentEvent && eventCount === 2
          ? [{ schema: "publishing-delivery-event/v1", id: "event_2", workspaceId: "workspace_1", deliveryId: "delivery_1", sequence: 2, type: "delivery.blocked", evidence: { failureCode: "CHANNEL_UNAVAILABLE", evidenceDigest: digest("8"), retryAt: "2026-08-09T12:01:30.000Z", blockCount: 1 }, occurredAt: "2026-08-09T12:01:00.000Z" }]
          : []
        : [{ schema: "publishing-delivery-event/v1", id: "event_1", workspaceId: "workspace_1", deliveryId: "delivery_1", sequence: 1, type: "delivery.accepted", evidence: { origin: "release", releaseId: "release_1", sourceDeliveryId: null, retryId: null, approvalRequestId: "approval_1", approvalDecisionId: "decision_1", targetSnapshotDigest: digest("3") }, occurredAt: "2026-08-09T11:00:00.000Z" }], nextAfterSequence: null });
    }
    if (body.capability === "publishing_deliveries.cancel@1") {
      return options.cancelDenied
        ? response({ success: false, error: "Exact Channel cancellation authority is unavailable." }, 403)
        : response(cancellation("prevented"));
    }
    if (body.capability === "publishing_deliveries.reconcile@1") return response({
      schema: "publishing-delivery-reconciliation/v1", reconciliationId: "reconcile_1", deliveryId: "delivery_1",
      sourceEvidenceDigest: digest("6"), effectKey: "publishing-effect:v1:workspace_1:delivery_1", effectGeneration: 1,
      status: "completed", resolution: "operator_required", requestedAt: "2026-08-09T12:00:04.000Z",
      completedAt: "2026-08-09T12:00:05.000Z", durable: true, externallyCompleted: null,
    });
    if (body.capability === "budget_status.get@1" && waitResumed) {
      const status = related("budget_status.get@1") as DeliveryOperationsResultMap["budget_status.get@1"];
      return response({
        ...status,
        evaluatedAt: "2026-08-09T12:00:06.000Z",
        items: status.items.map((item) => ({
          ...item,
          committed: "10.00",
          available: "0.00",
          warningState: "hard_limit_reached",
        })),
      });
    }
    if (["quota_policies.get_effective@1", "quota_reservations.list@1", "quota_waits.list@1"].includes(body.capability)) {
      const readCount = (quotaReadCounts.get(body.capability) ?? 0) + 1;
      quotaReadCounts.set(body.capability, readCount);
      if (options.quotaDeniedAfterReload && readCount > 1) {
        return response({ success: false, error: "Quota owner or admin role required." }, 403);
      }
    }
    if (body.capability === "quota_waits.list@1" && options.quotaWait) return response({
      schema: "quota-wait-list/v1", items: [quotaWait(waitResumed ? "resumed" : "waiting")],
    });
    if (body.capability === "quota_waits.resume@1") {
      waitMutationAttempted = true;
      if (options.waitDenied) return response({ success: false, error: "Quota Wait resume authority denied." }, 403);
      waitResumed = true;
      return response({ wait: quotaWait("resumed") });
    }
    if (body.capability === "spend_controls.get@2") {
      return options.spendDenied
        ? response({ success: false, error: "Owner or admin required." }, 403)
        : response(spendEvidence);
    }
    if (body.capability === "spend_controls.suspend@2" || body.capability === "spend_controls.resume@2") {
      spendMutationAttempted = true;
      if (options.spendMutationDenied) {
        return response({ success: false, error: "Spend-control authority denied." }, 403);
      }
      spendEvidence = { ...spendEvidence, suspended: body.capability.endsWith("suspend@2"), revision: spendEvidence.revision + 1, reason: String(body.input.reason), policyEventId: `spend_event_${spendEvidence.revision + 1}` };
      return response(spendEvidence);
    }
    return response(related(body.capability));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

describe("DeliveryOperationsCockpit", () => {
  beforeEach(() => window.localStorage.setItem("node-banana-active-workspace-id", "workspace_1"));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders exact immutable, ambiguous, capacity, and durable spend evidence accessibly", async () => {
    installFetch({ cancellationOutcome: "unknown" });
    render(<DeliveryOperationsCockpit deliveryId="delivery_1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading canonical Delivery evidence");
    expect(await screen.findByText("outcome_unknown")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Exact Publishing Plan Revision" })).toBeInTheDocument();
    expect(screen.getAllByText("decision_1", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText("warning")).toBeInTheDocument();
    expect(screen.getByText("contains unknown cost", { exact: false })).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === "DD" && element.textContent?.includes("unknown from state dispatching") === true)).toBeInTheDocument();
    expect(screen.getByText("externally reversed false", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Provider outcome is ambiguous", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("held_unknown_cost", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("9.00 / 10.00 USD committed", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("spend_event_1", { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText("Durable policy reason")).toBeInTheDocument();
  });

  it("loads retained events before the authoritative Delivery snapshot across a bootstrap transition", async () => {
    const { calls } = installFetch({ state: "scheduled", bootstrapTransition: true });
    render(<DeliveryOperationsCockpit deliveryId="delivery_1" />);
    expect(await screen.findByText("blocked")).toBeInTheDocument();
    expect(calls.findIndex((call) => call.capability === "publishing_delivery_events.list@2"))
      .toBeLessThan(calls.findIndex((call) => call.capability === "publishing_deliveries.get@2"));
  });

  it.each(["prevented", "conditional", "unknown", "too_late"] as const)(
    "reconstructs %s cancellation truth from the durable inspection read",
    async (outcome) => {
      installFetch({ cancellationOutcome: outcome });
      render(<DeliveryOperationsCockpit deliveryId="delivery_1" />);
      expect(await screen.findByText((_, element) => element?.tagName === "DD" && element.textContent?.includes(`${outcome} from state`) === true)).toBeInTheDocument();
      expect(screen.getByText("durable true", { exact: false })).toBeInTheDocument();
      expect(screen.getByText("externally reversed false", { exact: false })).toBeInTheDocument();
    },
  );

  it("stops a stale cancellation before dispatch when an Agent changed the Delivery", async () => {
    const { calls } = installFetch({ state: "scheduled", staleOnAction: true });
    render(<DeliveryOperationsCockpit deliveryId="delivery_1" />);
    const cancel = await screen.findByRole("button", { name: "Cancel future Delivery" });
    fireEvent.click(cancel);
    expect(await screen.findByText("Action was not sent because the screen was stale.")).toBeInTheDocument();
    expect(calls.some((call) => call.capability === "publishing_deliveries.cancel@1")).toBe(false);
    expect(screen.getByText("blocked")).toBeInTheDocument();
  });

  it("allows cancellation while dispatching is still provably before provider contact", async () => {
    installFetch({ state: "dispatching", futureDispatching: true });
    render(<DeliveryOperationsCockpit deliveryId="delivery_1" />);
    expect(await screen.findByRole("button", { name: "Cancel future Delivery" })).toBeEnabled();
  });

  it("reloads canonical state after an exact-authority cancellation denial without clearing inspection", async () => {
    const { calls } = installFetch({ state: "scheduled", cancelDenied: true });
    render(<DeliveryOperationsCockpit deliveryId="delivery_1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel future Delivery" }));
    expect(await screen.findByText("Exact Channel cancellation authority is unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Publishing Delivery" })).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((call) => call.capability === "publishing_deliveries.get@2").length).toBeGreaterThanOrEqual(3));
  });

  it("requests reconciliation from fresh ambiguity evidence and reloads authoritative panels", async () => {
    const { calls } = installFetch();
    render(<DeliveryOperationsCockpit deliveryId="delivery_1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Request reconciliation" }));
    expect(await screen.findByText("operator_required", { exact: false })).toBeInTheDocument();
    expect(calls).toContainEqual(expect.objectContaining({
      capability: "publishing_deliveries.reconcile@1",
      input: expect.objectContaining({ expectedUnknownEvidenceDigest: digest("6") }),
    }));
    expect(calls.filter((call) => call.capability === "publishing_deliveries.get@2").length).toBeGreaterThanOrEqual(3);
  });

  it("persists Emergency Spend Suspension evidence and reconstructs it on reload", async () => {
    const { calls } = installFetch({ state: "scheduled" });
    render(<DeliveryOperationsCockpit deliveryId="delivery_1" />);
    fireEvent.change(await screen.findByLabelText("Durable policy reason"), { target: { value: "Provider incident" } });
    fireEvent.click(screen.getByRole("button", { name: "Enable Emergency Spend Suspension" }));
    expect(await screen.findByText("Provider incident")).toBeInTheDocument();
    expect(screen.getAllByText("spend_event_2", { exact: false }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Reload canonical view" }));
    await waitFor(() => expect(calls.filter((call) => call.capability === "spend_controls.get@2").length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText("Suspended")).toBeInTheDocument();
    expect(screen.getByText("Provider incident")).toBeInTheDocument();
  });

  it("clears protected evidence when the shared spend-control read loses authorization", async () => {
    installFetch({ spendDenied: true });
    render(<DeliveryOperationsCockpit deliveryId="delivery_1" />);
    expect(await screen.findByText("Authorization was lost", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("provider_operation_1")).not.toBeInTheDocument();
  });

  it("clears protected evidence when a denied spend mutation is followed by core membership loss", async () => {
    installFetch({ spendMutationDenied: true, membershipLostAfterSpendDenial: true });
    render(<DeliveryOperationsCockpit deliveryId="delivery_1" />);
    fireEvent.change(await screen.findByLabelText("Durable policy reason"), { target: { value: "Incident" } });
    fireEvent.click(screen.getByRole("button", { name: "Enable Emergency Spend Suspension" }));
    expect(await screen.findByText("Authorization was lost", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("provider_operation_1")).not.toBeInTheDocument();
  });

  it("observes a concurrent Agent event and refreshes the authoritative Delivery", async () => {
    vi.useFakeTimers();
    installFetch({ state: "scheduled", concurrentEvent: true });
    render(<DeliveryOperationsCockpit deliveryId="delivery_1" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("scheduled")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.getByText("blocked")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Concurrent Delivery changes were observed");
  });

  it("re-evaluates an eligible Quota Wait through the shared mutation", async () => {
    const { calls } = installFetch({ quotaWait: true });
    render(<DeliveryOperationsCockpit deliveryId="delivery_1" />);
    const waits = await screen.findByRole("region", { name: "Quota Wait eligibility and resumptions" });
    expect(within(waits).getByText((_, element) => element?.tagName === "P" && element.textContent?.includes("Run run_wait_1") === true)).toBeInTheDocument();
    expect(within(waits).getByText("Requests 1 count of run.concurrent@1")).toBeInTheDocument();
    expect(within(waits).getByText("requiredAvailable", { exact: false })).toBeInTheDocument();
    expect(within(waits).getByText("quota_evidence_1", { exact: false })).toBeInTheDocument();
    fireEvent.click(within(waits).getByRole("button", { name: "Re-evaluate and resume" }));
    expect(await screen.findByText("resumed", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getAllByText("quota_reservation_2", { exact: false }).length).toBeGreaterThan(0);
    expect(calls.some((call) => call.capability === "quota_waits.resume@1")).toBe(true);
    expect(await screen.findByText("hard limit reached")).toBeInTheDocument();
    expect(calls.filter((call) => call.capability === "budget_status.get@1").length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((call) => call.capability === "quota_policies.get_effective@1").length).toBeGreaterThanOrEqual(2);
  });

  it("clears protected evidence when a denied Wait mutation is followed by core membership loss", async () => {
    installFetch({ quotaWait: true, waitDenied: true, membershipLostAfterWaitDenial: true });
    render(<DeliveryOperationsCockpit deliveryId="delivery_1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Re-evaluate and resume" }));
    expect(await screen.findByText("Authorization was lost", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("provider_operation_1")).not.toBeInTheDocument();
  });

  it("keeps Delivery evidence but clears stale Quota rows after a quota-role denial", async () => {
    installFetch({ quotaWait: true, quotaDeniedAfterReload: true });
    render(<DeliveryOperationsCockpit deliveryId="delivery_1" />);
    expect(await screen.findByRole("button", { name: "Re-evaluate and resume" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload canonical view" }));
    expect(await within(screen.getByRole("region", { name: "Quota Wait eligibility and resumptions" })).findByRole("alert")).toHaveTextContent("Quota owner or admin role required");
    expect(screen.getByRole("heading", { name: "Publishing Delivery" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Re-evaluate and resume" })).not.toBeInTheDocument();
    expect(screen.queryByText("Authorization was lost", { exact: false })).not.toBeInTheDocument();
  });

  it("clears protected evidence and stops polling on a core read authorization loss", async () => {
    vi.useFakeTimers();
    const { fetchMock } = installFetch({ eventAuthLoss: true });
    render(<DeliveryOperationsCockpit deliveryId="delivery_1" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("outcome_unknown")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.getByText("Authorization was lost", { exact: false })).toBeInTheDocument();
    const afterLoss = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(afterLoss);
    expect(screen.queryByText("provider_operation_1")).not.toBeInTheDocument();
  });
});
