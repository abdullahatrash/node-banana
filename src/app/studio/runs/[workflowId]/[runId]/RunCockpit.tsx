"use client";

import { useTranslations } from "next-intl";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TechnicalBlock, TechnicalCode } from "@/components/ui/technical-data";
import type { ArtifactMetadata } from "@/lib/agent-runtime/artifacts/types";
import type {
  WorkflowRunDto,
  WorkflowRunEventDto,
  WorkflowStepAttemptDto,
} from "@/lib/agent-runtime/runs/types";
import {
  mergeWorkflowRunEventPages,
  workflowRunArtifactMembership,
  workflowRunInspectionQueryPlan,
} from "@/lib/agent-runtime/runs/inspection";
import {
  getActiveWorkspaceId,
  invokeRunInspectionApplicationCapability,
  type DiagnosticTraceDto,
  type RunInspectionResultMap,
  StudioApiError,
} from "@/lib/studio/client";

type ArtifactResult = { artifact: ArtifactMetadata; textContent: string | null };
const TRACE_FIELDS = [
  "category", "severity", "code", "stage", "outcome", "providerFamily",
  "httpStatus", "retryable", "durationMs", "attempt", "createdAt", "expiresAt",
] as const satisfies readonly (keyof DiagnosticTraceDto)[];

function display(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? "Unknown"
    : String(value);
}

function artifactIds(run: WorkflowRunDto, attempts: WorkflowStepAttemptDto[]): string[] {
  return workflowRunArtifactMembership({ run, attempts }).map((item) => item.artifactId);
}

function Panel(props: {
  title: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={props.title} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="text-lg font-medium">{props.title}</h2>
      {props.error
        ? <p role="alert" className="mt-3 rounded-md border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-200">{props.error}</p>
        : props.children}
    </section>
  );
}

function RunState({ state }: { state: WorkflowRunDto["state"] }) {
  const uncertain = state === "outcome_unknown" || state === "waiting";
  return (
    <span className={`rounded-full px-3 py-1 text-sm font-medium ${uncertain ? "bg-amber-950 text-amber-200" : state === "completed" ? "bg-emerald-950 text-emerald-200" : state === "failed" ? "bg-red-950 text-red-200" : "bg-sky-950 text-sky-200"}`}>
      {state.replaceAll("_", " ")}
    </span>
  );
}

export function RunCockpit(props: { workflowId: string; runId: string }) {
  const t = useTranslations("runtimeUi.runInspection");
  const [run, setRun] = useState<WorkflowRunDto | null>(null);
  const [revision, setRevision] = useState<RunInspectionResultMap["workflow_versions.get@2"] | null>(null);
  const [attempts, setAttempts] = useState<WorkflowStepAttemptDto[]>([]);
  const [events, setEvents] = useState<WorkflowRunEventDto[]>([]);
  const [eventCursor, setEventCursor] = useState<string | null>(null);
  const [eventPageFull, setEventPageFull] = useState(false);
  const [artifacts, setArtifacts] = useState<ArtifactResult[]>([]);
  const [usage, setUsage] = useState<RunInspectionResultMap["usage_records.list@1"]["items"]>([]);
  const [usageCursor, setUsageCursor] = useState<string | null>(null);
  const [valuations, setValuations] = useState<RunInspectionResultMap["cost_valuations.list@1"]["items"]>([]);
  const [valuationCursor, setValuationCursor] = useState<string | null>(null);
  const [usageSummary, setUsageSummary] = useState<RunInspectionResultMap["usage_summaries.get@1"] | null>(null);
  const [budgetReservations, setBudgetReservations] = useState<RunInspectionResultMap["budget_reservations.list@1"]["items"]>([]);
  const [quotaReservations, setQuotaReservations] = useState<RunInspectionResultMap["quota_reservations.list@1"]["items"]>([]);
  const [quotaWaits, setQuotaWaits] = useState<RunInspectionResultMap["quota_waits.list@1"]["items"]>([]);
  const [trace, setTrace] = useState<RunInspectionResultMap["diagnostic_traces.get@1"] | null>(null);
  const [traceRef, setTraceRef] = useState<string | null>(null);
  const [failureTraceRefs, setFailureTraceRefs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [authLost, setAuthLost] = useState(false);
  const [status, setStatus] = useState("Loading canonical Run evidence.");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requestGeneration = useRef(0);
  const pollActive = useRef(false);
  const eventCursorRef = useRef<string | null>(null);
  const eventsRef = useRef<WorkflowRunEventDto[]>([]);
  const usageContinuationLoaded = useRef(false);
  const valuationContinuationLoaded = useRef(false);

  useEffect(() => { eventCursorRef.current = eventCursor; }, [eventCursor]);
  useEffect(() => { eventsRef.current = events; }, [events]);

  const clearProtectedState = useCallback(() => {
    setRun(null);
    setRevision(null);
    setAttempts([]);
    setEvents([]);
    setEventCursor(null);
    setEventPageFull(false);
    setArtifacts([]);
    setUsage([]);
    setUsageCursor(null);
    setValuations([]);
    setValuationCursor(null);
    setUsageSummary(null);
    setBudgetReservations([]);
    setQuotaReservations([]);
    setQuotaWaits([]);
    setTrace(null);
    setTraceRef(null);
    setFailureTraceRefs([]);
    usageContinuationLoaded.current = false;
    valuationContinuationLoaded.current = false;
  }, []);

  const loseAuthorization = useCallback(() => {
    ++requestGeneration.current;
    clearProtectedState();
    setAuthLost(true);
    setStatus("Authorization lost. Live updates stopped and protected evidence cleared.");
  }, [clearProtectedState]);

  const message = useCallback((cause: unknown) => {
    if (cause instanceof StudioApiError && cause.operatorTraceRef) {
      const operatorTraceRef = cause.operatorTraceRef;
      setFailureTraceRefs((current) => current.includes(operatorTraceRef)
        ? current
        : [...current, operatorTraceRef]);
      setTraceRef((current) => current ?? operatorTraceRef);
    }
    return cause instanceof Error
      ? cause.message
      : "Canonical evidence is unavailable.";
  }, []);

  const loadArtifacts = useCallback(async (
    currentRun: WorkflowRunDto,
    currentAttempts: WorkflowStepAttemptDto[],
    generation: number,
  ) => {
    const results = await Promise.allSettled(artifactIds(currentRun, currentAttempts).map(
      (artifactId) => invokeRunInspectionApplicationCapability(
        "workflow_run_artifacts.get@2",
        { workflowId: props.workflowId, runId: props.runId, artifactId },
      ),
    ));
    if (generation !== requestGeneration.current) return;
    const authorizationFailure = results.find((result) =>
      result.status === "rejected" &&
      result.reason instanceof StudioApiError &&
      (result.reason.status === 401 || result.reason.status === 403));
    if (authorizationFailure) {
      loseAuthorization();
      return;
    }
    const available = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []);
    for (const result of results) {
      if (result.status === "rejected") message(result.reason);
    }
    setArtifacts(available);
    setErrors((current) => ({
      ...current,
      artifacts: results.some((result) => result.status === "rejected")
        ? "Some Run-proven Artifacts are currently unavailable."
        : "",
    }));
  }, [loseAuthorization, message, props.runId, props.workflowId]);

  const refreshEvidence = useCallback(async (
    generation: number,
    options: { preserveLedgerPages?: boolean } = {},
  ) => {
    const plan = workflowRunInspectionQueryPlan({
      workflowId: props.workflowId,
      runId: props.runId,
      pageSize: 100,
    });
    const results = await Promise.allSettled([
      invokeRunInspectionApplicationCapability(plan.run.capability, plan.run.input),
      invokeRunInspectionApplicationCapability(plan.attempts.capability, plan.attempts.input),
      invokeRunInspectionApplicationCapability(plan.usage.capability, plan.usage.input),
      invokeRunInspectionApplicationCapability(plan.valuations.capability, plan.valuations.input),
      invokeRunInspectionApplicationCapability(plan.summary.capability, plan.summary.input),
      invokeRunInspectionApplicationCapability(plan.budgetReservations.capability, plan.budgetReservations.input),
      invokeRunInspectionApplicationCapability(plan.quotaReservations.capability, plan.quotaReservations.input),
      invokeRunInspectionApplicationCapability(plan.quotaWaits.capability, plan.quotaWaits.input),
    ] as const);
    if (generation !== requestGeneration.current) return false;
    const authorizationFailure = results.find((result) =>
      result.status === "rejected" &&
      result.reason instanceof StudioApiError &&
      (result.reason.status === 401 || result.reason.status === 403));
    if (authorizationFailure) {
      loseAuthorization();
      return false;
    }
    const runResult = results[0];
    if (runResult.status === "rejected") {
      setErrors((current) => ({ ...current, run: message(runResult.reason) }));
      return false;
    }
    setRun(runResult.value);
    setErrors((current) => ({ ...current, run: "" }));
    const attemptResult = results[1];
    const currentAttempts = attemptResult.status === "fulfilled" ? attemptResult.value.items : [];
    if (attemptResult.status === "fulfilled") setAttempts(currentAttempts);
    const attemptError = attemptResult.status === "rejected" ? message(attemptResult.reason) : "";
    const usageError = results[2].status === "rejected" ? message(results[2].reason) : "";
    const valuationsError = results[3].status === "rejected" ? message(results[3].reason) : "";
    const usageSummaryError = results[4].status === "rejected" ? message(results[4].reason) : "";
    const budgetError = results[5].status === "rejected" ? message(results[5].reason) : "";
    const quotaError = results[6].status === "rejected" ? message(results[6].reason) : "";
    const waitsError = results[7].status === "rejected" ? message(results[7].reason) : "";
    setErrors((current) => ({
      ...current,
      attempts: attemptError,
      usage: usageError,
      valuations: valuationsError,
      usageSummary: usageSummaryError,
      budget: budgetError,
      quota: quotaError,
      waits: waitsError,
    }));
    if (results[2].status === "fulfilled") {
      const firstPage = results[2].value.items;
      setUsage((current) => options.preserveLedgerPages && usageContinuationLoaded.current
        ? [...firstPage, ...current.filter((item) => !firstPage.some((fresh) => fresh.id === item.id))]
        : firstPage);
      if (!(options.preserveLedgerPages && usageContinuationLoaded.current)) {
        setUsageCursor(results[2].value.nextCursor);
      }
    }
    if (results[3].status === "fulfilled") {
      const firstPage = results[3].value.items;
      setValuations((current) => options.preserveLedgerPages && valuationContinuationLoaded.current
        ? [...firstPage, ...current.filter((item) => !firstPage.some((fresh) => fresh.id === item.id))]
        : firstPage);
      if (!(options.preserveLedgerPages && valuationContinuationLoaded.current)) {
        setValuationCursor(results[3].value.nextCursor);
      }
    }
    if (results[4].status === "fulfilled") setUsageSummary(results[4].value);
    if (results[5].status === "fulfilled") setBudgetReservations(results[5].value.items);
    if (results[6].status === "fulfilled") setQuotaReservations(results[6].value.items);
    if (results[7].status === "fulfilled") setQuotaWaits(results[7].value.items);
    const revisionQuery = workflowRunInspectionQueryPlan({
      workflowId: props.workflowId,
      runId: props.runId,
      workflowRevisionId: runResult.value.workflowRevisionId,
    }).revision!;
    const revisionResult = await invokeRunInspectionApplicationCapability(
      revisionQuery.capability,
      revisionQuery.input,
    ).then((value) => ({ value }), (reason) => ({ reason }));
    if (generation !== requestGeneration.current) return false;
    if ("reason" in revisionResult && revisionResult.reason instanceof StudioApiError &&
      (revisionResult.reason.status === 401 || revisionResult.reason.status === 403)) {
      loseAuthorization();
      return false;
    }
    if ("value" in revisionResult) setRevision(revisionResult.value);
    const revisionError = "reason" in revisionResult ? message(revisionResult.reason) : "";
    setErrors((current) => ({
      ...current,
      revision: revisionError,
    }));
    await loadArtifacts(runResult.value, currentAttempts, generation);
    return true;
  }, [loadArtifacts, loseAuthorization, message, props.runId, props.workflowId]);

  const bootstrap = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setAuthLost(false);
    setErrors({});
    setTrace(null);
    setTraceRef(null);
    setFailureTraceRefs([]);
    usageContinuationLoaded.current = false;
    valuationContinuationLoaded.current = false;
    setStatus("Loading canonical Run evidence.");
    if (!getActiveWorkspaceId()) {
      clearProtectedState();
      setErrors({ run: "Select a Workspace before inspecting a Workflow Run." });
      setLoading(false);
      return;
    }
    const eventQuery = workflowRunInspectionQueryPlan({
      workflowId: props.workflowId,
      runId: props.runId,
    }).events;
    const eventRequest = invokeRunInspectionApplicationCapability(
      eventQuery.capability,
      eventQuery.input,
    );
    const [evidenceReady, eventResult] = await Promise.all([
      refreshEvidence(generation),
      eventRequest.then((value) => ({ value }), (reason) => ({ reason })),
    ]);
    if (generation !== requestGeneration.current) return;
    if ("value" in eventResult) {
      setEvents(eventResult.value.items);
      setEventCursor(eventResult.value.nextCursor);
      setEventPageFull(eventResult.value.items.length === 100);
    } else {
      if (eventResult.reason instanceof StudioApiError &&
        (eventResult.reason.status === 401 || eventResult.reason.status === 403)) {
        loseAuthorization();
        setLoading(false);
        return;
      }
      setErrors((current) => ({ ...current, events: message(eventResult.reason) }));
    }
    setLoading(false);
    if (evidenceReady) setStatus("Canonical Run evidence loaded. Live event updates are active.");
  }, [clearProtectedState, message, props.runId, props.workflowId, refreshEvidence]);

  const continueEvents = useCallback(async () => {
    const cursor = eventCursorRef.current;
    if (!cursor || authLost || pollActive.current) return;
    pollActive.current = true;
    try {
      const eventQuery = workflowRunInspectionQueryPlan({
        workflowId: props.workflowId,
        runId: props.runId,
        eventCursor: cursor,
      }).events;
      const page = await invokeRunInspectionApplicationCapability(
        eventQuery.capability,
        eventQuery.input,
      );
      const current = eventsRef.current;
      const lastSequence = current.at(-1)?.sequence ?? 0;
      const merged = mergeWorkflowRunEventPages(current, page.items);
      const unseen = merged.filter((event) => event.sequence > lastSequence);
      if (unseen.length) {
        setEvents(merged);
        await refreshEvidence(requestGeneration.current, { preserveLedgerPages: true });
        setStatus(`${unseen.length} retained Run event${unseen.length === 1 ? "" : "s"} applied; authoritative panels refreshed without discarding loaded ledger pages.`);
      }
      setEventCursor(page.nextCursor);
      setEventPageFull(page.items.length === 100);
      setErrors((value) => ({ ...value, events: "" }));
    } catch (cause) {
      if (cause instanceof StudioApiError && (cause.status === 401 || cause.status === 403)) {
        loseAuthorization();
      } else {
        setErrors((value) => ({ ...value, events: message(cause) }));
      }
    } finally {
      pollActive.current = false;
    }
  }, [authLost, loseAuthorization, message, props.runId, props.workflowId, refreshEvidence]);

  useEffect(() => {
    void bootstrap();
    return () => { ++requestGeneration.current; };
  }, [bootstrap]);

  useEffect(() => {
    if (authLost || !eventCursor) return;
    const timer = window.setInterval(() => { void continueEvents(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [authLost, continueEvents, eventCursor]);

  const inputArtifactIds = useMemo(() =>
    new Set(run?.startSnapshot.artifactReferences.map((item) => item.artifactId) ?? []), [run]);
  const traceReferences = useMemo(() => {
    const refs = new Set(failureTraceRefs);
    for (const attempt of attempts) {
      const ref = attempt.providerMetadata?.evidence.operatorTraceRef;
      if (ref) refs.add(ref);
    }
    for (const item of usage) {
      if (item.evidence.operatorTraceRef) refs.add(item.evidence.operatorTraceRef);
    }
    if (traceRef) refs.add(traceRef);
    return [...refs];
  }, [attempts, failureTraceRefs, traceRef, usage]);

  async function copyTraceReference() {
    if (!traceRef) return;
    await navigator.clipboard.writeText(traceRef);
    setStatus("Operator Trace Reference copied.");
  }

  async function loadMoreUsage() {
    if (!usageCursor) return;
    try {
      const result = await invokeRunInspectionApplicationCapability("usage_records.list@1", {
        runId: props.runId, limit: 100, cursor: usageCursor,
      });
      setUsage((current) => [...current, ...result.items]);
      setUsageCursor(result.nextCursor);
      usageContinuationLoaded.current = true;
    } catch (cause) {
      if (cause instanceof StudioApiError && (cause.status === 401 || cause.status === 403)) {
        loseAuthorization();
      } else {
        setErrors((current) => ({ ...current, usage: message(cause) }));
      }
    }
  }

  async function loadMoreValuations() {
    if (!valuationCursor) return;
    try {
      const result = await invokeRunInspectionApplicationCapability("cost_valuations.list@1", {
        runId: props.runId, limit: 100, cursor: valuationCursor,
      });
      setValuations((current) => [...current, ...result.items]);
      setValuationCursor(result.nextCursor);
      valuationContinuationLoaded.current = true;
    } catch (cause) {
      if (cause instanceof StudioApiError && (cause.status === 401 || cause.status === 403)) {
        loseAuthorization();
      } else {
        setErrors((current) => ({ ...current, valuations: message(cause) }));
      }
    }
  }

  async function inspectTrace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const operatorTraceRef = String(data.get("operatorTraceRef") ?? "").trim();
    const operatorGrantId = String(data.get("operatorGrantId") ?? "").trim();
    setTrace(null);
    try {
      setTrace(await invokeRunInspectionApplicationCapability("diagnostic_traces.get@1", {
        operatorTraceRef,
        operatorGrantId,
      }));
      setErrors((current) => ({ ...current, trace: "" }));
    } catch (cause) {
      if (cause instanceof StudioApiError && cause.status === 401) {
        loseAuthorization();
        return;
      }
      setErrors((current) => ({
        ...current,
        trace: cause instanceof StudioApiError && (cause.status === 403 || cause.status === 404)
          ? t("copy.diagnosticTraceUnavailable")
          : message(cause),
      }));
    }
  }

  if (loading && !run) {
    return <main aria-busy="true" className="min-h-screen bg-neutral-950 p-8 text-neutral-100"><p role="status">{t("copy.loadingCanonicalRunEvidence")}</p></main>;
  }

  if (authLost) {
    return <main className="min-h-screen bg-neutral-950 p-8 text-neutral-100"><h1 className="text-2xl font-semibold">{t("copy.workflowRunInspectionUnavailable")}</h1><p role="alert" className="mt-3 text-amber-200">{t("copy.authorizationWasLostProtectedRunEvidenceWas")}</p></main>;
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-5 py-8 text-neutral-100">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-400">{t("copy.canonicalRuntimeEvidence")}</p>
            <h1 className="mt-2 text-3xl font-semibold">{t("copy.workflowRun")}</h1>
            <TechnicalCode className="mt-2 text-sm text-neutral-400">{props.runId}</TechnicalCode>
          </div>
          <div className="flex items-center gap-3">
            {run ? <RunState state={run.state} /> : null}
            <button type="button" onClick={() => void bootstrap()} className="rounded-md border border-neutral-700 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400">{t("copy.reloadCanonicalView")}</button>
          </div>
        </header>
        <p aria-live="polite" role="status" className="sr-only">{status}</p>
        {errors.run ? <p role="alert" className="rounded-md border border-red-900 bg-red-950/40 p-4 text-red-200">{errors.run}</p> : null}

        {run ? <section aria-labelledby="run-snapshot" className="grid gap-4 md:grid-cols-4">
          <h2 id="run-snapshot" className="sr-only">{t("copy.runSnapshot")}</h2>
          {(["workflowRevisionId", "startSnapshotDigest", "acceptedAt", "failureCode"] as const).map((key) => <article key={key} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"><p className="text-xs uppercase tracking-wide text-neutral-500">{t(`copy.${key}`)}</p><TechnicalCode className="mt-2 text-sm">{display(run[key])}</TechnicalCode></article>)}
        </section> : null}

        <Panel title={t("copy.immutableWorkflowRevision")} error={errors.revision}>
          {revision ? <div className="mt-4 space-y-3 text-sm"><p><span className="text-neutral-500">{t("copy.revision")}</span> {display(revision.revision)} · <TechnicalCode>{display(revision.definitionDigest)}</TechnicalCode></p><p><span className="text-neutral-500">{t("copy.operationRegistry")}</span> <TechnicalCode>{display(revision.operationRegistryDigest)}</TechnicalCode></p><ol className="space-y-2">{run?.startSnapshot.operationContracts.map((item) => <li key={item.stepId} className="rounded-lg bg-neutral-950 p-3"><TechnicalCode className="font-semibold">{item.stepId}</TechnicalCode> · <TechnicalCode>{item.identity}</TechnicalCode><br /><TechnicalCode className="text-xs text-neutral-500">{item.contractDigest}</TechnicalCode></li>)}</ol><details><summary className="cursor-pointer font-medium">{t("copy.exactImmutableDefinition")}</summary><TechnicalBlock className="mt-2 max-h-96 whitespace-pre-wrap rounded bg-neutral-950 p-3 text-xs">{JSON.stringify(revision.definition, null, 2)}</TechnicalBlock></details></div> : <p className="mt-3 text-neutral-500">{t("copy.revisionEvidenceIsLoading")}</p>}
        </Panel>

        <Panel title={t("copy.canonicalRunSnapshots")}>
          {run ? <div className="mt-4 grid gap-4 lg:grid-cols-2"><details open><summary className="cursor-pointer font-medium">{t("copy.retainedStartSnapshot")}</summary><TechnicalBlock className="mt-2 max-h-96 whitespace-pre-wrap rounded bg-neutral-950 p-3 text-xs">{JSON.stringify({ schema: run.startSnapshot.schema, workflowId: run.startSnapshot.workflowId, workflowRevisionId: run.startSnapshot.workflowRevisionId, workflowRevision: run.startSnapshot.workflowRevision, definitionDigest: run.startSnapshot.definitionDigest, operationRegistryDigest: run.startSnapshot.operationRegistryDigest, inputs: run.startSnapshot.inputs, operationContracts: run.startSnapshot.operationContracts, artifactReferences: run.startSnapshot.artifactReferences, providerResolutions: run.startSnapshot.providerResolutions ?? [] }, null, 2)}</TechnicalBlock></details><details open><summary className="cursor-pointer font-medium">{t("copy.retainedFinalSnapshot")}</summary>{run.finalSnapshot ? <TechnicalBlock className="mt-2 max-h-96 whitespace-pre-wrap rounded bg-neutral-950 p-3 text-xs">{JSON.stringify(run.finalSnapshot, null, 2)}</TechnicalBlock> : <p className="mt-2 text-sm text-neutral-500">{t("copy.unknownNoFinalSnapshotIsDurableYet")}</p>}</details></div> : <p className="mt-3 text-neutral-500">{t("copy.runSnapshotEvidenceIsUnavailable")}</p>}
        </Panel>

        {run?.derivation ? <Panel title={t("copy.retryLineage")}><div className="mt-3 text-sm"><p>{t("copy.derivedFromRun")} <TechnicalCode>{run.derivation.sourceRunId}</TechnicalCode>{t("copy.root")} <TechnicalCode>{run.derivation.rootRunId}</TechnicalCode>{t("copy.fromStep")} <TechnicalCode className="font-semibold">{run.derivation.retryFromStepId}</TechnicalCode>.</p><p className="mt-2 text-neutral-400">{run.derivation.reusedOutputs.length} {t("copy.priorStepOutputSetSReusedWithout")}</p></div></Panel> : null}

        <Panel title={t("copy.stepAttempts")} error={errors.attempts}>
          <div className="mt-4 overflow-x-auto"><table className="w-full text-start text-sm"><thead className="text-neutral-500"><tr><th scope="col" className="pb-2">{t("copy.stepAttempt")}</th><th scope="col">{t("copy.state")}</th><th scope="col">{t("copy.operation")}</th><th scope="col">{t("copy.effectKey")}</th><th scope="col">{t("copy.outcome")}</th></tr></thead><tbody>{attempts.map((attempt) => <tr key={attempt.id} className="border-t border-neutral-800"><th scope="row" className="py-3"><TechnicalCode>{attempt.stepId} / {attempt.attempt}</TechnicalCode></th><td><TechnicalCode>{attempt.state}</TechnicalCode></td><td><TechnicalCode>{attempt.provider} · {attempt.model}</TechnicalCode></td><td><TechnicalCode className="text-xs">{attempt.effectKey}</TechnicalCode></td><td><TechnicalCode>{attempt.outcome?.kind ?? t("copy.inProgress")}{attempt.failureCode ? ` · ${attempt.failureCode}` : ""}</TechnicalCode></td></tr>)}</tbody></table>{attempts.length === 0 ? <p className="py-4 text-neutral-500">{t("copy.noStepAttemptHasStartedTheAccepted")}</p> : null}</div>
        </Panel>

        <Panel title={t("copy.inputAndOutputArtifacts")} error={errors.artifacts}>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">{artifacts.map(({ artifact, textContent }) => <article key={artifact.id} className="rounded-lg bg-neutral-950 p-4 text-sm"><div className="flex justify-between gap-3"><strong>{inputArtifactIds.has(artifact.id) ? t("copy.input") : t("copy.output")} · <TechnicalCode>{artifact.kind}</TechnicalCode></strong><TechnicalCode>{artifact.sizeBytes} {t("copy.bytes")}</TechnicalCode></div><TechnicalCode className="mt-2 text-xs text-neutral-500">{artifact.id} · {artifact.digest}</TechnicalCode><p className="mt-2"><TechnicalCode>{artifact.mediaType}</TechnicalCode> {t("copy.origin")} <TechnicalCode>{artifact.origin.kind}</TechnicalCode></p>{artifact.origin.kind === "generated" ? <p className="mt-2 text-xs text-neutral-400">{t("copy.revision")} <TechnicalCode>{artifact.origin.workflowRevision.revision}</TechnicalCode> {t("copy.run")} <TechnicalCode>{artifact.origin.run.runId}</TechnicalCode> {t("copy.attempt")} <TechnicalCode>{artifact.origin.stepAttempt.stepAttemptId}</TechnicalCode> {t("copy.effect")} <TechnicalCode>{artifact.origin.effectKey}</TechnicalCode></p> : null}<ul className="mt-2 list-disc ps-5 text-xs text-neutral-400">{artifact.lineage.inputs.map((input, index) => <li key={`${input.port}:${index}`}><TechnicalCode>{input.port} ← {input.source.kind} · {display(input.artifactId)}</TechnicalCode></li>)}</ul>{textContent ? <p dir="auto" className="mt-3 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-neutral-900 p-2">{textContent}</p> : null}</article>)}</div>
        </Panel>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title={t("copy.usageRecords")} error={errors.usage}><div className="mt-4 space-y-3">{usage.map((item) => <article key={display(item.id)} className="rounded-lg bg-neutral-950 p-3 text-sm"><div className="flex justify-between gap-3"><TechnicalCode>{display(item.dimension)}</TechnicalCode><TechnicalCode className={item.quantity == null ? "text-amber-200" : "text-emerald-200"}>{display(item.quantity)} {display(item.unit)}</TechnicalCode></div><p className="mt-1 text-xs text-neutral-500">{t("copy.source")} <TechnicalCode>{display(item.source)}</TechnicalCode> {t("copy.directChargeAttribution")} <TechnicalCode>{display(item.directArtifactId)}</TechnicalCode></p><p className="mt-1 text-xs text-neutral-500">{t("copy.nonChargeLineageContext")} <TechnicalCode>{Array.isArray(item.lineageArtifactIds) && item.lineageArtifactIds.length ? item.lineageArtifactIds.join(", ") : t("copy.none")}</TechnicalCode></p>{item.supersedesUsageRecordId ? <p className="mt-1 text-xs">{t("copy.correctionSupersedes")} <TechnicalCode>{display(item.supersedesUsageRecordId)}</TechnicalCode></p> : null}</article>)}</div>{usageCursor ? <button type="button" onClick={() => void loadMoreUsage()} className="mt-4 rounded border border-neutral-700 px-3 py-2 text-sm">{t("copy.loadMoreUsage")}</button> : null}</Panel>
          <Panel title={t("copy.costValuations")} error={errors.valuations}><div className="mt-4 space-y-3">{valuations.map((item) => <article key={display(item.id)} className="rounded-lg bg-neutral-950 p-3 text-sm"><div className="flex justify-between gap-3"><span>{display(item.basis)} · {display(item.pricingSource)}</span><strong className={item.amount == null ? "text-amber-200" : "text-emerald-200"}>{display(item.amount)} {item.currency ? display(item.currency) : ""}</strong></div><p className="mt-1 text-xs text-neutral-500">{t("copy.pricingSnapshots")} {Array.isArray(item.pricingSnapshotIds) ? item.pricingSnapshotIds.length : 0} {t("copy.supersedes")} {display(item.supersedesCostValuationId)}</p></article>)}</div>{valuationCursor ? <button type="button" onClick={() => void loadMoreValuations()} className="mt-4 rounded border border-neutral-700 px-3 py-2 text-sm">{t("copy.loadMoreValuations")}</button> : null}</Panel>
        </div>

        <Panel title={t("copy.usageCertainty")} error={errors.usageSummary}><div className="mt-4 text-sm"><p className={usageSummary?.complete === true ? "text-emerald-200" : "text-amber-200"}>{usageSummary?.complete === true ? t("copy.allApplicableValuesKnown") : t("copy.containsUnknownUsage")}</p><div className="mt-3 flex flex-wrap gap-3">{usageSummary?.costSubtotals.map((subtotal) => <TechnicalCode key={subtotal.currency} className="rounded bg-neutral-950 px-3 py-2">{subtotal.amount} {subtotal.currency}</TechnicalCode>)}</div><p className="mt-2 text-xs text-neutral-500">{t("copy.currencySubtotalsRemainSeparateLineageContextIs")}</p></div></Panel>

        <div className="grid gap-6 xl:grid-cols-3">
          <Panel title={t("copy.budgetReservations")} error={errors.budget}><ul className="mt-3 space-y-2 text-sm">{budgetReservations.map((item) => <li key={item.id} className="rounded bg-neutral-950 p-3"><TechnicalCode>{item.state}</TechnicalCode> {t("copy.reserved")} <TechnicalCode>{item.reservedAmount} {item.currency}</TechnicalCode> {t("copy.held")} <TechnicalCode>{item.heldAmount}</TechnicalCode> {t("copy.settled")} <TechnicalCode>{item.settledAmount}</TechnicalCode> {t("copy.released")} <TechnicalCode>{item.releasedAmount}</TechnicalCode></li>)}</ul></Panel>
          <Panel title={t("copy.quotaReservations")} error={errors.quota}><p className="mt-3 text-xs text-neutral-500">{t("copy.showingUpTo100RowsThisCapability")}</p><ul className="mt-3 space-y-2 text-sm">{quotaReservations.map((item) => <li key={item.id} className="rounded bg-neutral-950 p-3"><TechnicalCode>{item.state} · {item.dimension}</TechnicalCode> {t("copy.reserved")} <TechnicalCode>{item.reservedAmount} {item.unit}</TechnicalCode> {t("copy.held")} <TechnicalCode>{item.heldAmount}</TechnicalCode> {t("copy.settled")} <TechnicalCode>{item.settledAmount}</TechnicalCode> {t("copy.released")} <TechnicalCode>{item.releasedAmount}</TechnicalCode> {t("copy.overage")} <TechnicalCode>{item.overageAmount}</TechnicalCode></li>)}</ul></Panel>
          <Panel title={t("copy.quotaWaits")} error={errors.waits}><p className="mt-3 text-xs text-neutral-500">{t("copy.showingUpTo100RowsThisCapability")}</p><ul className="mt-3 space-y-2 text-sm">{quotaWaits.map((item) => <li key={item.id} className="rounded bg-neutral-950 p-3"><TechnicalCode>{item.state}</TechnicalCode> {t("copy.eligible")} <TechnicalCode>{display(item.eligibleAt)}</TechnicalCode></li>)}</ul></Panel>
        </div>

        <Panel title={t("copy.orderedRetainedRunEvents")} error={errors.events}><ol className="mt-4 space-y-2">{events.map((event) => <li key={event.id} className="border-s border-neutral-700 ps-3 text-sm"><TechnicalCode className="font-semibold">#{event.sequence} · {event.type}</TechnicalCode><time dir="ltr" className="ms-2 inline-block text-xs text-neutral-500 [unicode-bidi:isolate]">{event.occurredAt}</time></li>)}</ol><div className="mt-4 flex gap-3"><button type="button" onClick={() => void continueEvents()} className="rounded border border-neutral-700 px-3 py-2 text-sm">{t("copy.checkForRetainedUpdates")}</button>{eventPageFull ? <button type="button" onClick={() => void continueEvents()} className="rounded border border-sky-800 px-3 py-2 text-sm text-sky-200">{t("copy.continueEventHistory")}</button> : null}</div></Panel>

        <Panel title={t("copy.sanitizedDiagnostics")} error={errors.trace}><form onSubmit={inspectTrace} className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr_auto]"><label className="text-sm">{t("copy.operatorTraceReference")}<select name="operatorTraceRef" required value={traceRef ?? ""} onChange={(event) => setTraceRef(event.target.value)} dir="ltr" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2"><option value="">{t("copy.selectReference")}</option>{traceReferences.map((ref) => <option key={ref}>{ref}</option>)}</select></label><button type="button" disabled={!traceRef} onClick={() => void copyTraceReference()} className="self-end rounded border border-neutral-700 px-3 py-2 text-sm disabled:opacity-50">{t("copy.copyTraceReference")}</button><label className="text-sm">{t("copy.activeTraceReadGrantID")}<input name="operatorGrantId" required dir="ltr" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2" /></label><button className="self-end rounded bg-sky-400 px-4 py-2 font-medium text-neutral-950">{t("copy.openSanitizedTrace")}</button></form>{trace ? <dl className="mt-4 grid gap-2 rounded-lg bg-neutral-950 p-4 text-sm md:grid-cols-2">{TRACE_FIELDS.map((key) => <div key={key}><dt className="text-xs text-neutral-500">{key}</dt><dd><TechnicalCode>{display(trace[key])}</TechnicalCode></dd></div>)}</dl> : <p className="mt-3 text-sm text-neutral-500">{t("copy.onlyAllowlistedTraceFieldsAreShownRaw")}</p>}</Panel>
      </div>
    </main>
  );
}
