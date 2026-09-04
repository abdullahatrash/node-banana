"use client";

import { useTranslations } from "next-intl";
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getActiveWorkspaceId,
  invokeDeliveryOperationsApplicationCapability,
  type DeliveryOperationsResultMap,
  StudioApiError,
} from "@/lib/studio/client";

type DeliveryInspection = DeliveryOperationsResultMap["publishing_deliveries.get@2"];
type Delivery = DeliveryInspection["delivery"];
type Cancellation = DeliveryInspection["cancellation"];
type Events = DeliveryOperationsResultMap["publishing_delivery_events.list@2"]["items"];
type PanelErrors = Partial<Record<
  "delivery" | "events" | "plan" | "approval" | "budget" | "quota" | "waits" | "spend" | "action",
  string
>>;

function display(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? "Unknown"
    : String(value);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function Panel(props: { title: string; error?: string; children: React.ReactNode }) {
  return (
    <section aria-label={props.title} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="text-lg font-medium">{props.title}</h2>
      {props.error
        ? <p role="alert" className="mt-3 rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-200">{props.error}</p>
        : props.children}
    </section>
  );
}

function stateFingerprint(delivery: Delivery): string {
  return [
    delivery.updatedAt,
    delivery.state,
    delivery.desiredState,
    delivery.latestEffectEvidenceDigest ?? "",
    delivery.nextEventSequence,
  ].join(":");
}

function mergeEvents(current: Events, incoming: Events): Events {
  const bySequence = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) {
    const prior = bySequence.get(event.sequence);
    if (prior && safeJson(prior) !== safeJson(event)) {
      throw new TypeError("Retained Delivery event sequence conflicts with prior evidence.");
    }
    bySequence.set(event.sequence, event);
  }
  const merged = [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
  for (let index = 1; index < merged.length; index += 1) {
    if (merged[index]!.sequence !== merged[index - 1]!.sequence + 1) {
      throw new TypeError("Retained Delivery event history contains a gap.");
    }
  }
  return merged;
}

export function DeliveryOperationsCockpit({ deliveryId }: { deliveryId: string }) {
  const t = useTranslations("runtimeUi.deliveryOperations");
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [cancellation, setCancellation] = useState<Cancellation>(null);
  const [events, setEvents] = useState<Events>([]);
  const [plan, setPlan] = useState<DeliveryOperationsResultMap["publishing_plan_revisions.get@2"] | null>(null);
  const [approval, setApproval] = useState<DeliveryOperationsResultMap["publishing_approvals.get@2"] | null>(null);
  const [budgetPolicies, setBudgetPolicies] = useState<DeliveryOperationsResultMap["budget_policies.get_effective@1"]["items"]>([]);
  const [budgetReservations, setBudgetReservations] = useState<DeliveryOperationsResultMap["budget_reservations.list@1"]["items"]>([]);
  const [budgetStatus, setBudgetStatus] = useState<DeliveryOperationsResultMap["budget_status.get@1"] | null>(null);
  const [quotaCapacities, setQuotaCapacities] = useState<DeliveryOperationsResultMap["quota_policies.get_effective@1"]["items"]>([]);
  const [quotaReservations, setQuotaReservations] = useState<DeliveryOperationsResultMap["quota_reservations.list@1"]["items"]>([]);
  const [quotaWaits, setQuotaWaits] = useState<DeliveryOperationsResultMap["quota_waits.list@1"]["items"]>([]);
  const [spendControl, setSpendControl] = useState<DeliveryOperationsResultMap["spend_controls.get@2"] | null>(null);
  const [actionEvidence, setActionEvidence] = useState<unknown>(null);
  const [errors, setErrors] = useState<PanelErrors>({});
  const [loading, setLoading] = useState(true);
  const [authLost, setAuthLost] = useState(false);
  const [status, setStatus] = useState("Loading canonical Delivery evidence.");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const generation = useRef(0);
  const eventsRef = useRef<Events>([]);
  const pollActive = useRef(false);
  const waitKeys = useRef(new Map<string, string>());

  useEffect(() => { eventsRef.current = events; }, [events]);

  const clearProtectedState = useCallback(() => {
    setDelivery(null);
    setCancellation(null);
    setEvents([]);
    setPlan(null);
    setApproval(null);
    setBudgetPolicies([]);
    setBudgetReservations([]);
    setBudgetStatus(null);
    setQuotaCapacities([]);
    setQuotaReservations([]);
    setQuotaWaits([]);
    setSpendControl(null);
    setActionEvidence(null);
    setErrors({});
    waitKeys.current.clear();
  }, []);

  const clearRelatedState = useCallback(() => {
    setPlan(null);
    setApproval(null);
    setBudgetPolicies([]);
    setBudgetReservations([]);
    setBudgetStatus(null);
    setQuotaCapacities([]);
    setQuotaReservations([]);
    setQuotaWaits([]);
    setSpendControl(null);
  }, []);

  const loseAuthorization = useCallback(() => {
    ++generation.current;
    clearProtectedState();
    setAuthLost(true);
    setLoading(false);
    setStatus("Authorization lost. Protected Delivery evidence was cleared and live updates stopped.");
  }, [clearProtectedState]);

  const message = useCallback((cause: unknown) => {
    if (cause instanceof StudioApiError && cause.operatorTraceRef) {
      return `${cause.message} Operator Trace Reference: ${cause.operatorTraceRef}.`;
    }
    return cause instanceof Error
      ? cause.message
      : "Canonical Delivery evidence is unavailable.";
  }, []);

  const loadRelated = useCallback(async (current: Delivery, token: number) => {
    const principalId = current.requestingPrincipalId;
    const values = await Promise.allSettled([
      invokeDeliveryOperationsApplicationCapability("publishing_plan_revisions.get@2", { revisionId: current.planRevisionId }),
      invokeDeliveryOperationsApplicationCapability("publishing_approvals.get@2", { approvalRequestId: current.approvalRequestId }),
      invokeDeliveryOperationsApplicationCapability("budget_policies.get_effective@1", { principalId }),
      invokeDeliveryOperationsApplicationCapability("budget_reservations.list@1", { principalId }),
      invokeDeliveryOperationsApplicationCapability("budget_status.get@1", { principalId }),
      invokeDeliveryOperationsApplicationCapability("quota_policies.get_effective@1", { principalId }),
      invokeDeliveryOperationsApplicationCapability("quota_reservations.list@1", { principalId, limit: 100 }),
      invokeDeliveryOperationsApplicationCapability("quota_waits.list@1", { principalId, limit: 100 }),
      invokeDeliveryOperationsApplicationCapability("spend_controls.get@2", {}),
    ] as const);
    if (token !== generation.current) return false;
    const sessionLoss = values.find((value, index) =>
      value.status === "rejected" && value.reason instanceof StudioApiError &&
      (value.reason.status === 401 ||
        (value.reason.status === 403 && (index < 5 || index === 8))));
    if (sessionLoss) {
      loseAuthorization();
      return false;
    }
    if (values[0].status === "fulfilled") setPlan(values[0].value);
    else setPlan(null);
    if (values[1].status === "fulfilled") setApproval(values[1].value);
    else setApproval(null);
    if (values[2].status === "fulfilled") setBudgetPolicies(values[2].value.items);
    else setBudgetPolicies([]);
    if (values[3].status === "fulfilled") setBudgetReservations(values[3].value.items);
    else setBudgetReservations([]);
    if (values[4].status === "fulfilled") setBudgetStatus(values[4].value);
    else setBudgetStatus(null);
    if (values[5].status === "fulfilled") setQuotaCapacities(values[5].value.items);
    else setQuotaCapacities([]);
    if (values[6].status === "fulfilled") setQuotaReservations(values[6].value.items);
    else setQuotaReservations([]);
    if (values[7].status === "fulfilled") setQuotaWaits(values[7].value.items);
    else setQuotaWaits([]);
    if (values[8].status === "fulfilled") setSpendControl(values[8].value);
    else setSpendControl(null);
    setErrors((currentErrors) => ({
      ...currentErrors,
      plan: values[0].status === "rejected" ? message(values[0].reason) : "",
      approval: values[1].status === "rejected" ? message(values[1].reason) : "",
      budget: values[2].status === "rejected" || values[3].status === "rejected" || values[4].status === "rejected"
        ? "Budget policy, Reservation, or canonical status evidence is unavailable; spend truth is Unknown."
        : "",
      quota: values[5].status === "rejected" || values[6].status === "rejected"
        ? "Effective Quota or Reservation evidence is unavailable; capacity is Unknown."
        : "",
      waits: values[7].status === "rejected" ? message(values[7].reason) : "",
      spend: values[8].status === "rejected" ? message(values[8].reason) : "",
    }));
    return true;
  }, [loseAuthorization, message]);

  const loadDelivery = useCallback(async (token: number) => {
    try {
      const inspection = await invokeDeliveryOperationsApplicationCapability(
        "publishing_deliveries.get@2",
        { deliveryId },
      );
      if (token !== generation.current) return null;
      const current = inspection.delivery;
      setDelivery(current);
      setCancellation(inspection.cancellation);
      setErrors((value) => ({ ...value, delivery: "" }));
      return current;
    } catch (cause) {
      if (token !== generation.current) return null;
      if (cause instanceof StudioApiError && (cause.status === 401 || cause.status === 403)) {
        loseAuthorization();
      } else {
        setErrors((value) => ({ ...value, delivery: message(cause) }));
      }
      return null;
    }
  }, [deliveryId, loseAuthorization, message]);

  const loadEvents = useCallback(async (token: number, afterSequence: number, reset: boolean) => {
    let after = afterSequence;
    let accumulated = reset ? [] as Events : eventsRef.current;
    try {
      do {
        const priorAfter = after;
        const page = await invokeDeliveryOperationsApplicationCapability(
          "publishing_delivery_events.list@2",
          { deliveryId, afterSequence: after, limit: 100 },
        );
        if (token !== generation.current) return false;
        accumulated = mergeEvents(accumulated, page.items);
        after = accumulated.at(-1)?.sequence ?? after;
        if (page.nextAfterSequence === null) break;
        if (after <= priorAfter) {
          throw new TypeError("Retained Delivery event continuation made no forward progress.");
        }
      } while (true);
      eventsRef.current = accumulated;
      setEvents(accumulated);
      setErrors((value) => ({ ...value, events: "" }));
      return true;
    } catch (cause) {
      if (token !== generation.current) return false;
      if (cause instanceof StudioApiError && (cause.status === 401 || cause.status === 403)) {
        loseAuthorization();
      } else {
        setErrors((value) => ({ ...value, events: message(cause) }));
      }
      return false;
    }
  }, [deliveryId, loseAuthorization, message]);

  const reload = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true);
    setAuthLost(false);
    setErrors({});
    setActionEvidence(null);
    clearRelatedState();
    setStatus("Loading canonical Delivery evidence.");
    if (!getActiveWorkspaceId()) {
      clearProtectedState();
      setErrors({ delivery: "Select a Workspace before operating a Publishing Delivery." });
      setLoading(false);
      return;
    }
    await loadEvents(token, 0, true);
    if (token !== generation.current) return;
    const current = await loadDelivery(token);
    if (token !== generation.current) return;
    if (current) await loadRelated(current, token);
    if (token !== generation.current) return;
    setLoading(false);
    if (current) setStatus("Canonical Delivery evidence loaded. Live retained-event updates are active.");
  }, [clearProtectedState, clearRelatedState, loadDelivery, loadEvents, loadRelated]);

  useEffect(() => {
    void reload();
    return () => { ++generation.current; };
  }, [reload]);

  const poll = useCallback(async () => {
    if (pollActive.current || authLost) return;
    pollActive.current = true;
    const token = generation.current;
    const priorSequence = eventsRef.current.at(-1)?.sequence ?? 0;
    try {
      const loaded = await loadEvents(token, priorSequence, false);
      if (!loaded || token !== generation.current) return;
      const nextSequence = eventsRef.current.at(-1)?.sequence ?? priorSequence;
      if (nextSequence > priorSequence) {
        const current = await loadDelivery(token);
        if (current) await loadRelated(current, token);
        setStatus("Concurrent Delivery changes were observed; authoritative panels were refreshed.");
      }
    } finally {
      pollActive.current = false;
    }
  }, [authLost, loadDelivery, loadEvents, loadRelated]);

  useEffect(() => {
    if (authLost || !delivery) return;
    const timer = window.setInterval(() => { void poll(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [authLost, delivery, poll]);

  const ensureFresh = useCallback(async () => {
    if (!delivery) return null;
    try {
      const inspection = await invokeDeliveryOperationsApplicationCapability(
        "publishing_deliveries.get@2",
        { deliveryId },
      );
      const current = inspection.delivery;
      if (stateFingerprint(current) !== stateFingerprint(delivery)) {
        setDelivery(current);
        setCancellation(inspection.cancellation);
        await loadRelated(current, generation.current);
        await loadEvents(generation.current, eventsRef.current.at(-1)?.sequence ?? 0, false);
        setStatus("This Delivery changed concurrently. Review the refreshed state before retrying the action.");
        setErrors((value) => ({ ...value, action: "Action was not sent because the screen was stale." }));
        return null;
      }
      return current;
    } catch (cause) {
      if (cause instanceof StudioApiError && (cause.status === 401 || cause.status === 403)) loseAuthorization();
      else setErrors((value) => ({ ...value, action: message(cause) }));
      return null;
    }
  }, [delivery, deliveryId, loadEvents, loadRelated, loseAuthorization, message]);

  async function cancelDelivery() {
    const current = await ensureFresh();
    if (!current) return;
    setBusyAction("cancel");
    try {
      const result = await invokeDeliveryOperationsApplicationCapability(
        "publishing_deliveries.cancel@1",
        { deliveryId, channelIds: [current.channelId], artifactIds: current.artifactIds },
      );
      setActionEvidence(result);
      setErrors((value) => ({ ...value, action: "" }));
      setStatus(`Cancellation recorded with canonical outcome ${result.outcome}.`);
      const refreshed = await loadDelivery(generation.current);
      if (refreshed) {
        await loadRelated(refreshed, generation.current);
        await loadEvents(generation.current, eventsRef.current.at(-1)?.sequence ?? 0, false);
      }
    } catch (cause) {
      if (cause instanceof StudioApiError && cause.status === 401) loseAuthorization();
      else {
        setErrors((value) => ({ ...value, action: message(cause) }));
        const refreshed = await loadDelivery(generation.current);
        if (refreshed) {
          await loadRelated(refreshed, generation.current);
          await loadEvents(generation.current, 0, true);
        }
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function reconcileDelivery() {
    const current = await ensureFresh();
    if (!current?.latestEffectEvidenceDigest) return;
    setBusyAction("reconcile");
    try {
      const result = await invokeDeliveryOperationsApplicationCapability(
        "publishing_deliveries.reconcile@1",
        {
          deliveryId,
          channelIds: [current.channelId],
          artifactIds: current.artifactIds,
          expectedUnknownEvidenceDigest: current.latestEffectEvidenceDigest,
        },
      );
      setActionEvidence(result);
      setErrors((value) => ({ ...value, action: "" }));
      setStatus(`Reconciliation ${result.status}; externally completed remains ${display(result.externallyCompleted)}.`);
      const refreshed = await loadDelivery(generation.current);
      if (refreshed) {
        await loadRelated(refreshed, generation.current);
        await loadEvents(generation.current, eventsRef.current.at(-1)?.sequence ?? 0, false);
      }
    } catch (cause) {
      if (cause instanceof StudioApiError && cause.status === 401) loseAuthorization();
      else {
        setErrors((value) => ({ ...value, action: message(cause) }));
        const refreshed = await loadDelivery(generation.current);
        if (refreshed) {
          await loadRelated(refreshed, generation.current);
          await loadEvents(generation.current, 0, true);
        }
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function resumeWait(waitId: string) {
    setBusyAction(`wait:${waitId}`);
    const idempotencyKey = waitKeys.current.get(waitId) ?? `quota-wait-${waitId}-${crypto.randomUUID()}`;
    waitKeys.current.set(waitId, idempotencyKey);
    try {
      const result = await invokeDeliveryOperationsApplicationCapability(
        "quota_waits.resume@1",
        { waitId },
        { idempotencyKey },
      );
      waitKeys.current.delete(waitId);
      setActionEvidence(result);
      setErrors((value) => ({ ...value, action: "" }));
      setStatus(`Quota Wait ${waitId} is now ${result.wait.state}.`);
      const refreshed = await loadDelivery(generation.current);
      if (refreshed) {
        await loadRelated(refreshed, generation.current);
        await loadEvents(generation.current, eventsRef.current.at(-1)?.sequence ?? 0, false);
      }
    } catch (cause) {
      if (cause instanceof StudioApiError && cause.status === 401) loseAuthorization();
      else {
        setErrors((value) => ({ ...value, action: message(cause) }));
        const refreshed = await loadDelivery(generation.current);
        if (refreshed) {
          await loadRelated(refreshed, generation.current);
          await loadEvents(generation.current, eventsRef.current.at(-1)?.sequence ?? 0, false);
        }
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function changeSuspension(event: FormEvent<HTMLFormElement>, suspended: boolean) {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = String(new FormData(form).get("reason") ?? "").trim();
    setBusyAction(suspended ? "suspend" : "resume-spend");
    try {
      const result = await invokeDeliveryOperationsApplicationCapability(
        suspended ? "spend_controls.suspend@2" : "spend_controls.resume@2",
        { reason },
      );
      setSpendControl(result);
      setActionEvidence(result);
      setErrors((value) => ({ ...value, action: "", spend: "" }));
      setStatus(suspended
        ? "Emergency Spend Suspension is enabled; new and not-yet-started provider spend is blocked."
        : "Emergency Spend Suspension is removed; work resumes only through canonical runtime transitions.");
      form.reset();
      const refreshed = await loadDelivery(generation.current);
      if (refreshed) {
        await loadRelated(refreshed, generation.current);
        await loadEvents(generation.current, eventsRef.current.at(-1)?.sequence ?? 0, false);
      }
    } catch (cause) {
      if (cause instanceof StudioApiError && cause.status === 401) loseAuthorization();
      else {
        setErrors((value) => ({ ...value, action: message(cause) }));
        const refreshed = await loadDelivery(generation.current);
        if (refreshed) {
          await loadRelated(refreshed, generation.current);
          await loadEvents(generation.current, eventsRef.current.at(-1)?.sequence ?? 0, false);
        }
      }
    } finally {
      setBusyAction(null);
    }
  }

  const futureCancellable = delivery?.desiredState === "publish" &&
    (delivery.state === "scheduled" || delivery.state === "blocked" ||
      (delivery.state === "dispatching" && delivery.effectContactStartedAt === null));
  const ambiguous = delivery?.state === "outcome_unknown";
  if (loading && !delivery) {
    return <main aria-busy="true" className="min-h-screen bg-neutral-950 p-8 text-neutral-100"><p role="status">{t("copy.loadingCanonicalDeliveryEvidence")}</p></main>;
  }
  if (authLost) {
    return <main className="min-h-screen bg-neutral-950 p-8 text-neutral-100"><h1 className="text-2xl font-semibold">{t("copy.deliveryOperationsUnavailable")}</h1><p role="alert" className="mt-3 text-amber-200">{t("copy.authorizationWasLostProtectedDeliveryEvidenceWas")}</p></main>;
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-5 py-8 text-neutral-100">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-400">{t("copy.canonicalPublishingOperations")}</p><h1 className="mt-2 text-3xl font-semibold">{t("copy.publishingDelivery")}</h1><p className="mt-2 font-mono text-sm text-neutral-400">{deliveryId}</p></div>
          <button type="button" onClick={() => void reload()} className="rounded border border-neutral-700 px-4 py-2 text-sm focus:ring-2 focus:ring-sky-400">{t("copy.reloadCanonicalView")}</button>
        </header>
        <p role="status" aria-live="polite" className="sr-only">{status}</p>
        {errors.delivery ? <p role="alert" className="rounded border border-red-900 bg-red-950/40 p-4 text-red-200">{errors.delivery}</p> : null}
        {errors.action ? <p role="alert" className="rounded border border-amber-900 bg-amber-950/40 p-4 text-amber-200">{errors.action}</p> : null}

        {delivery ? <section aria-label={t("copy.deliveryCanonicalState")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
          ["State", delivery.state], ["Desired state", delivery.desiredState], ["Publish at", delivery.publishAt], ["Externally completed", display(delivery.externallyCompleted)],
          ["Target", delivery.targetId], ["Channel", delivery.channelId], ["Effect generation", delivery.effectGeneration], ["Updated", delivery.updatedAt],
        ].map(([label, value]) => <article key={label} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"><h2 className="text-xs uppercase text-neutral-500">{label}</h2><p className="mt-2 break-all text-sm">{value}</p></article>)}</section> : null}

        <Panel title={t("copy.deliveryTargetScheduleAndValidation")} error={errors.delivery}>
          {delivery ? <div className="mt-4 grid gap-4 lg:grid-cols-2"><dl className="space-y-2 text-sm"><div><dt className="text-neutral-500">{t("copy.planRevision")}</dt><dd>{delivery.planRevision} · <code>{delivery.planRevisionId}</code></dd></div><div><dt className="text-neutral-500">{t("copy.approval")}</dt><dd><code>{delivery.approvalRequestId}</code> {t("copy.decision")} <code>{delivery.approvalDecisionId}</code></dd></div><div><dt className="text-neutral-500">{t("copy.artifacts")}</dt><dd>{delivery.artifactIds.join(", ")}</dd></div><div><dt className="text-neutral-500">{t("copy.schedule")}</dt><dd>{delivery.targetSnapshot.target.timing.kind} · {delivery.publishAt}</dd></div><div><dt className="text-neutral-500">{t("copy.validationBlockers")}</dt><dd>{delivery.targetSnapshot.validation.blockerCodes.length ? delivery.targetSnapshot.validation.blockerCodes.join(", ") : "None at immutable validation"}</dd></div></dl><details><summary className="cursor-pointer font-medium">{t("copy.exactImmutableTargetSnapshot")}</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-neutral-950 p-3 text-xs">{safeJson(delivery.targetSnapshot)}</pre></details></div> : <p className="mt-3 text-neutral-500">{t("copy.unknown")}</p>}
        </Panel>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title={t("copy.exactPublishingPlanRevision")} error={errors.plan}>{plan ? <details open className="mt-4"><summary className="cursor-pointer">{t("copy.revision")} {plan.revision} · {plan.definitionDigest}</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-neutral-950 p-3 text-xs">{safeJson(plan)}</pre></details> : <p className="mt-3 text-neutral-500">{t("copy.unknown")}</p>}</Panel>
          <Panel title={t("copy.exactPublishingApproval")} error={errors.approval}>{approval ? <div className="mt-4 text-sm"><p>{t("copy.status")} <strong>{approval.approval.status}</strong> {t("copy.inspection")} <code>{approval.approval.inspectionDigest}</code></p><p className="mt-2">{t("copy.decision2")} {approval.approval.decision?.decision ?? "Unknown"} {t("copy.consumed")} {approval.approval.consumption ? "yes" : "no"}</p><details className="mt-3"><summary className="cursor-pointer">{t("copy.approvalBindingAndEvidence")}</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-neutral-950 p-3 text-xs">{safeJson(approval.approval)}</pre></details></div> : <p className="mt-3 text-neutral-500">{t("copy.unknown")}</p>}</Panel>
        </div>

        <Panel title={t("copy.effectAndCancellationTruth")}>
          {delivery ? <div className="mt-4 grid gap-4 lg:grid-cols-2"><dl className="space-y-2 text-sm"><div><dt className="text-neutral-500">{t("copy.effectKey")}</dt><dd><code>{delivery.effectKey}</code></dd></div><div><dt className="text-neutral-500">{t("copy.intentAdapterContract")}</dt><dd><code>{display(delivery.intentDigest)}</code><br /><code>{display(delivery.providerAdapterContractDigest)}</code></dd></div><div><dt className="text-neutral-500">{t("copy.providerOperation")}</dt><dd>{display(delivery.providerOperationRef)}</dd></div><div><dt className="text-neutral-500">{t("copy.latestEffectEvidence")}</dt><dd><code>{display(delivery.latestEffectEvidenceDigest)}</code></dd></div><div><dt className="text-neutral-500">{t("copy.failure")}</dt><dd>{display(delivery.failureCode)} · {display(delivery.failureClass)} {t("copy.retryable")} {display(delivery.failureRetryable)}</dd></div><div><dt className="text-neutral-500">{t("copy.durableCancellationRecord")}</dt><dd>{cancellation ? <><strong>{cancellation.outcome}</strong> {t("copy.fromState")} {cancellation.stateAtRequest}{t("copy.externallyCompletedAtRequest")} {display(cancellation.externallyCompletedAtRequest)}{t("copy.durable")} {String(cancellation.durable)}{t("copy.externallyReversed")} {String(cancellation.externallyReversed)}</> : "No cancellation request is recorded."}</dd></div></dl><div className="rounded bg-neutral-950 p-4"><p className="text-sm text-neutral-400">{t("copy.actionsReReadCurrentCanonicalStateFirst")}</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={!futureCancellable || busyAction !== null} onClick={() => void cancelDelivery()} className="rounded bg-red-300 px-4 py-2 text-sm font-medium text-red-950 disabled:opacity-40">{t("copy.cancelFutureDelivery")}</button><button type="button" disabled={!ambiguous || !delivery.latestEffectEvidenceDigest || busyAction !== null} onClick={() => void reconcileDelivery()} className="rounded bg-amber-300 px-4 py-2 text-sm font-medium text-amber-950 disabled:opacity-40">{t("copy.requestReconciliation")}</button></div>{ambiguous ? <p className="mt-3 text-sm text-amber-200">{t("copy.providerOutcomeIsAmbiguousUnknownIsNot")}</p> : null}</div></div> : null}
        </Panel>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title={t("copy.budgetReservationsAndSpendWarnings")} error={errors.budget}><div className="mt-4 space-y-3 text-sm">{budgetPolicies.map(({ policy, revision }) => <article key={policy.id} className="rounded bg-neutral-950 p-3">{policy.scope} · {policy.currency} {t("copy.warning")} {revision.warningThreshold} {t("copy.hardLimit")} {revision.hardLimit} {t("copy.unknownPricing")} {revision.unknownPriceTreatment}</article>)}{budgetReservations.map((item) => <article key={item.id} className="rounded bg-neutral-950 p-3"><code>{item.id}</code> {t("copy.run")} <code>{item.runId}</code> {t("copy.policy")} <code>{item.policyRevisionId}</code><br />{item.state} {t("copy.reserved")} {item.reservedAmount} {item.currency} {t("copy.held")} {item.heldAmount} {t("copy.settled")} {item.settledAmount} {t("copy.released")} {item.releasedAmount}<br /><span className="text-neutral-500">{t("copy.period")} {item.period.kind} · {item.period.startsAt} → {display(item.period.endsAt)}</span></article>)}{budgetStatus ? <><p className="text-xs text-neutral-500">{t("copy.canonicalStatusEvaluated")} {budgetStatus.evaluatedAt}.</p>{budgetStatus.items.map((item) => <article key={`${item.scope}:${item.policyRevisionId}`} className="rounded border border-neutral-800 bg-neutral-950 p-3"><strong>{item.warningState.replaceAll("_", " ")}</strong> · {item.committed} / {item.hardLimit} {item.currency} {t("copy.committed")} {item.available} {t("copy.available")}<br /><span className={item.certainty === "known" ? "text-neutral-400" : "text-amber-200"}>{item.certainty.replaceAll("_", " ")} {t("copy.unknownCostReservations")} {item.unknownReservationCount}</span><br /><span className="text-neutral-500">{item.scope} {t("copy.policy2")} <code>{item.policyRevisionId}</code> {t("copy.period2")} {item.period.kind} {item.period.startsAt} → {display(item.period.endsAt)}</span></article>)}</> : <p className="text-neutral-500">{t("copy.currentSpendWarningTruthUnknownNoCanonical")}</p>}</div></Panel>
          <Panel title={t("copy.effectiveQuotasAndReservations")} error={errors.quota}><div className="mt-4 space-y-3 text-sm">{quotaCapacities.map((item) => <article key={item.policy.id} className="rounded bg-neutral-950 p-3">{item.policy.dimension} {t("copy.committed2")} {item.committed} {item.policy.unit} {t("copy.available2")} {item.available} {t("copy.warning")} {display(item.warning)} {t("copy.exhausted")} {display(item.exhausted)}</article>)}{quotaReservations.map((item) => <article key={item.id} className="rounded bg-neutral-950 p-3"><code>{item.id}</code> {t("copy.run")} <code>{display(item.runId)}</code> {t("copy.policy")} <code>{item.policyRevisionId}</code><br />{item.state} · {item.dimension} {t("copy.reserved")} {item.reservedAmount} {item.unit} {t("copy.overage")} {item.overageAmount}<br /><span className="text-neutral-500">{t("copy.window")} {item.window.kind} · {safeJson(item.window)}</span></article>)}<p className="text-xs text-neutral-500">{t("copy.showingUpTo100ReservationRowsThis")}</p></div></Panel>
        </div>

        <Panel title={t("copy.quotaWaitEligibilityAndResumptions")} error={errors.waits}><div className="mt-4 space-y-3">{quotaWaits.map((wait) => <article key={wait.id} className="rounded bg-neutral-950 p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-3"><p><strong>{wait.state}</strong> · {wait.boundary} {t("copy.eligible")} {display(wait.eligibleAt)}</p>{wait.state === "waiting" ? <button type="button" disabled={busyAction !== null} onClick={() => void resumeWait(wait.id)} className="rounded border border-sky-700 px-3 py-2 text-sky-200 disabled:opacity-40">{t("copy.reEvaluateAndResume")}</button> : null}</div><p className="mt-2"><code>{wait.id}</code> {t("copy.run")} <code>{wait.runId}</code> {t("copy.transition")} <code>{wait.transitionKey}</code></p><p className="mt-2 text-neutral-400">{t("copy.subject")} {wait.subject.kind} <code>{wait.subject.id}</code> · {wait.reasonCode}</p><ul className="mt-2 list-disc ps-5 text-neutral-300">{wait.claims.map((claim) => <li key={`${claim.dimension}:${claim.unit}`}>{t("copy.requests")} {claim.amount} {claim.unit} {t("copy.of")} {claim.dimension}</li>)}</ul><p className="mt-2 text-neutral-400">{t("copy.resumeReason")} {display(wait.resumeReason)} {t("copy.actor")} {wait.resumedBy ? safeJson(wait.resumedBy) : "Unknown"} {t("copy.reservations")} {wait.resolutionReservationIds.join(", ") || "None"}</p><details className="mt-3"><summary className="cursor-pointer">{t("copy.canonicalEligibilityEvidence")}{wait.evidence.length})</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded border border-neutral-800 p-3 text-xs text-neutral-400">{safeJson(wait.evidence)}</pre></details></article>)}{quotaWaits.length === 0 ? <p className="text-sm text-neutral-500">{t("copy.noQuotaWaitEvidenceForThisDelivery")}</p> : null}<p className="text-xs text-neutral-500">{t("copy.showingUpTo100WaitRowsThis")}</p></div></Panel>

        <Panel title={t("copy.emergencySpendSuspension")} error={errors.spend}><div className="mt-4 grid gap-4 lg:grid-cols-2"><div><p className={`text-lg font-medium ${spendControl?.suspended ? "text-red-200" : "text-emerald-200"}`}>{spendControl ? (spendControl.suspended ? "Suspended" : "Not suspended") : "Unknown"}</p><p className="mt-2 text-sm text-neutral-400">{t("copy.suspensionBlocksNewAndNotYetStarted")}</p>{spendControl ? <dl className="mt-3 space-y-1 text-sm"><div><dt className="inline text-neutral-500">{t("copy.revision")} </dt><dd className="inline">{spendControl.revision}</dd></div><div><dt className="inline text-neutral-500">{t("copy.reason")} </dt><dd className="inline">{display(spendControl.reason)}</dd></div><div><dt className="inline text-neutral-500">{t("copy.actorRecorded")} </dt><dd className="inline">{display(spendControl.actorUserId)} · {display(spendControl.recordedAt)}</dd></div><div><dt className="inline text-neutral-500">{t("copy.policyEventAuthorizationEvidence")} </dt><dd className="inline"><code>{display(spendControl.policyEventId)}</code> · <code>{display(spendControl.authorizationEvidenceRef)}</code></dd></div></dl> : null}</div><form onSubmit={(event) => void changeSuspension(event, !spendControl?.suspended)} className="space-y-3"><label className="block text-sm">{t("copy.durablePolicyReason")}<textarea name="reason" required minLength={1} maxLength={500} className="mt-1 min-h-24 w-full rounded border border-neutral-700 bg-neutral-950 p-3" /></label><button disabled={!spendControl || busyAction !== null} className="rounded bg-sky-300 px-4 py-2 font-medium text-sky-950 disabled:opacity-40">{spendControl?.suspended ? "Remove Emergency Spend Suspension" : "Enable Emergency Spend Suspension"}</button></form></div></Panel>

        <Panel title={t("copy.orderedRetainedDeliveryEvents")} error={errors.events}><ol className="mt-4 space-y-3">{events.map((event) => <li key={event.id} className="border-s border-neutral-700 ps-3 text-sm"><p><strong>#{event.sequence}</strong> · {event.type} <time className="text-neutral-500">{event.occurredAt}</time></p><pre className="mt-1 overflow-auto whitespace-pre-wrap text-xs text-neutral-500">{safeJson(event.evidence)}</pre></li>)}</ol><button type="button" onClick={() => void poll()} className="mt-4 rounded border border-neutral-700 px-3 py-2 text-sm">{t("copy.checkForConcurrentChanges")}</button></Panel>

        {actionEvidence ? <Panel title={t("copy.latestCanonicalActionResult")}><pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-neutral-950 p-3 text-xs">{safeJson(actionEvidence)}</pre></Panel> : null}
      </div>
    </main>
  );
}
