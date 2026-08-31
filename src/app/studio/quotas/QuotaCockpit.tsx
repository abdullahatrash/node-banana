"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  getActiveWorkspaceId,
  invokeQuotaApplicationCapability,
} from "@/lib/studio/client";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function text(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}

function dimensionLabel(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  const dimension = record(value);
  return [dimension.kind, dimension.key].filter(Boolean).map(String).join(" · ") || "Quota capacity";
}

function waitEvidence(wait: JsonRecord): JsonRecord {
  return records(wait.evidence)[0] ?? record(wait.eligibility);
}

function resumeActorLabel(value: unknown): string {
  const actor = record(value);
  if (actor.kind === "human") return `human ${text(actor.userId)}`;
  if (actor.kind === "principal") return `Agent ${text(actor.principalId)}`;
  if (actor.kind === "system") return "system";
  return "—";
}

export function QuotaCockpit() {
  const [policies, setPolicies] = useState<JsonRecord[]>([]);
  const [capacities, setCapacities] = useState<JsonRecord[]>([]);
  const [reservations, setReservations] = useState<JsonRecord[]>([]);
  const [waits, setWaits] = useState<JsonRecord[]>([]);
  const [suspended, setSuspended] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const submitKeys = useRef(
    new Map<string, { payload: string; idempotencyKey: string }>(),
  );

  const stableSubmitKey = useCallback(
    (scope: string, input: Record<string, unknown>) => {
      const payload = JSON.stringify(input);
      const current = submitKeys.current.get(scope);
      if (current?.payload === payload) return current.idempotencyKey;
      const idempotencyKey = crypto.randomUUID();
      submitKeys.current.set(scope, { payload, idempotencyKey });
      return idempotencyKey;
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!getActiveWorkspaceId()) {
      throw new Error("Select a Workspace before managing quotas.");
    }
    const [policyResult, reservationResult, waitResult, spendResult] =
      await Promise.all([
        invokeQuotaApplicationCapability("quota_policies.list@1"),
        invokeQuotaApplicationCapability("quota_reservations.list@1"),
        invokeQuotaApplicationCapability("quota_waits.list@1"),
        invokeQuotaApplicationCapability("spend_controls.get@1"),
      ]);
    setPolicies(records(policyResult.items));
    setReservations(records(reservationResult.items));
    setWaits(records(waitResult.items));
    setSuspended(spendResult.suspended === true);
  }, []);

  useEffect(() => {
    void refresh().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [refresh]);

  async function resumeWait(wait: JsonRecord) {
    setError("");
    const waitId = String(wait.waitId ?? wait.id ?? "");
    const input = { waitId };
    const scope = `quota_waits.resume@1:${waitId}`;
    try {
      await invokeQuotaApplicationCapability("quota_waits.resume@1", input, {
        idempotencyKey: stableSubmitKey(scope, input),
      });
      submitKeys.current.delete(scope);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Quota Wait resume failed.");
    }
  }

  async function loadEffectiveCapacity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const principalId = String(new FormData(event.currentTarget).get("principalId") ?? "").trim();
    try {
      const result = await invokeQuotaApplicationCapability(
        "quota_policies.get_effective@1",
        { principalId },
      );
      setCapacities(records(result.items));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Effective Quota capacity is unavailable.");
    }
  }

  async function createPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const principalId = String(data.get("principalId") ?? "").trim();
    const input = {
      principalId: principalId || null,
      kind: data.get("kind"),
      boundary: data.get("boundary"),
      dimension: String(data.get("dimension") ?? "").trim(),
      unit: data.get("unit"),
      window: data.get("window"),
      timezone: String(data.get("timezone") ?? "").trim(),
      reservationRule: data.get("reservationRule"),
      warningThreshold: String(data.get("warningThreshold") ?? "").trim(),
      hardLimit: String(data.get("hardLimit") ?? "").trim(),
      exhaustionBehavior: data.get("exhaustionBehavior"),
    };
    const scope = "quota_policy_revisions.create@1";
    try {
      await invokeQuotaApplicationCapability(scope, input, {
        idempotencyKey: stableSubmitKey(scope, input),
      });
      submitKeys.current.delete(scope);
      form.reset();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Quota policy creation failed.");
    }
  }

  async function setSpendControl(nextSuspended: boolean) {
    setError("");
    if (!reason.trim()) {
      setError("Record a reason before changing emergency spend controls.");
      return;
    }
    const capability = nextSuspended
      ? "spend_controls.suspend@1" as const
      : "spend_controls.resume@1" as const;
    const input = { reason: reason.trim() };
    try {
      await invokeQuotaApplicationCapability(
        capability,
        input,
        { idempotencyKey: stableSubmitKey(capability, input) },
      );
      submitKeys.current.delete(capability);
      setReason("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Spend control update failed.");
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-8 text-neutral-100">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-400">Runtime capacity</p>
            <h1 className="mt-2 text-3xl font-semibold">Quotas &amp; Waits</h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-400">Effective non-monetary capacity, durable reservations, renewable waits, resumptions, warnings, and provider-effect blocks.</p>
          </div>
          <button type="button" onClick={() => void refresh().catch((cause) => setError(String(cause)))} className="rounded-md border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900">Refresh</button>
        </header>

        {error ? <p role="alert" className="rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-200">{error}</p> : null}

        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">Emergency provider spend</h2>
              <p className={`mt-1 text-sm ${suspended ? "text-red-300" : "text-emerald-300"}`}>{suspended ? "New provider effects blocked" : "Provider effects enabled"}</p>
              <p className="mt-1 text-xs text-neutral-500">Suspension preserves accepted Runs, Usage Records, and reservations.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input aria-label="Spend control reason" value={reason} onChange={(event) => setReason(event.target.value)} className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" placeholder="Audit reason" />
              <button type="button" onClick={() => void setSpendControl(true)} disabled={suspended} className="rounded-md border border-red-800 px-3 py-2 text-sm disabled:opacity-40">Suspend</button>
              <button type="button" onClick={() => void setSpendControl(false)} disabled={!suspended} className="rounded-md border border-emerald-800 px-3 py-2 text-sm disabled:opacity-40">Resume</button>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">Quota policies</h2>
            <div className="mt-4 space-y-3">
              {policies.length ? policies.map((item, index) => {
                const policy = record(item.policy);
                const revision = record(item.revision);
                const dimension = revision.dimension ?? policy.dimension ?? item.dimension;
                return <article key={text(policy.id ?? item.id ?? index)} className="rounded-lg bg-neutral-950 p-3 text-sm"><div className="flex justify-between gap-3"><strong>{dimensionLabel(dimension)}</strong><code>{text(revision.hardLimit)} {text(policy.unit)}</code></div><p className="mt-1 text-xs text-neutral-500">{text(policy.scope)} · {text(policy.kind)} / {text(policy.boundary)} · {text(policy.window)} · {text(policy.timezone)}</p><p className="mt-1 text-xs text-neutral-500">{text(policy.reservationRule)} · exhaustion {text(revision.exhaustionBehavior)} · warning {text(revision.warningThreshold)}</p></article>;
              }) : <p className="text-sm text-neutral-500">No Quota Policy configured.</p>}
            </div>
          </div>

          <form onSubmit={createPolicy} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">Create policy revision</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input name="principalId" aria-label="Policy Principal ID" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" placeholder="Principal ID (blank = Workspace)" />
              <select name="kind" aria-label="Quota kind" defaultValue="concurrency" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="admission">admission</option><option value="concurrency">concurrency</option><option value="rate">rate</option><option value="storage">storage</option><option value="usage">usage</option></select>
              <select name="boundary" aria-label="Quota boundary" defaultValue="run_concurrency" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="run_admission">run admission</option><option value="run_concurrency">run concurrency</option><option value="provider_effect">provider effect</option><option value="artifact_storage">artifact storage</option><option value="usage_settlement">usage settlement</option></select>
              <input name="dimension" aria-label="Quota dimension" required defaultValue="runtime.concurrent_runs@1" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
              <select name="unit" aria-label="Quota unit" defaultValue="count" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="count">count</option><option value="byte">byte</option><option value="millisecond">millisecond</option><option value="megapixel">megapixel</option></select>
              <select name="window" aria-label="Quota window" defaultValue="concurrent" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="concurrent">concurrent</option><option value="calendar_minute">calendar minute</option><option value="calendar_hour">calendar hour</option><option value="calendar_day">calendar day</option><option value="calendar_week">calendar week</option><option value="calendar_month">calendar month</option><option value="lifetime">lifetime</option></select>
              <input name="timezone" aria-label="Quota timezone" required defaultValue="UTC" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
              <select name="reservationRule" aria-label="Reservation rule" defaultValue="release_on_terminal" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="consume">consume</option><option value="release_on_terminal">release on terminal</option><option value="release_on_transition">release on transition</option></select>
              <input name="warningThreshold" aria-label="Quota warning threshold" required inputMode="decimal" placeholder="8" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
              <input name="hardLimit" aria-label="Quota hard limit" required inputMode="decimal" placeholder="10" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
              <select name="exhaustionBehavior" aria-label="Exhaustion behavior" defaultValue="wait" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="wait">wait when renewable</option><option value="deny">deny</option></select>
            </div>
            <button className="mt-4 rounded-md bg-sky-400 px-4 py-2 text-sm font-medium text-neutral-950">Create revision</button>
          </form>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">Agent effective capacity</h2>
            <form onSubmit={loadEffectiveCapacity} className="mt-4 flex gap-2"><input name="principalId" aria-label="Capacity Principal ID" required className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" placeholder="principal_…" /><button className="rounded-md border border-sky-800 px-3 py-2 text-sm text-sky-200">Load</button></form>
            <div className="mt-4 space-y-3">{capacities.length ? capacities.map((item, index) => { const policy = record(item.policy); const revision = record(item.revision); const warning = item.warning === true; const exhausted = item.exhausted === true; return <article key={text(policy.id ?? index)} className="rounded-lg bg-neutral-950 p-3 text-sm"><div className="flex justify-between gap-3"><strong>{dimensionLabel(policy.dimension)}</strong><code>{text(item.available)} / {text(revision.hardLimit)} {text(policy.unit)}</code></div><p className="mt-1 text-xs text-neutral-500">Committed {text(item.committed)} · evaluated {text(item.evaluatedAt)}</p>{warning ? <p className="mt-2 text-xs text-amber-300">Warning threshold reached</p> : null}{exhausted ? <p className="mt-1 text-xs text-red-300">Capacity exhausted · blocks {text(Array.isArray(item.blockingReservationIds) ? item.blockingReservationIds.join(", ") : item.blockingReservationIds)}</p> : null}</article>; }) : <p className="text-sm text-neutral-500">Load an Agent Principal to inspect effective Workspace and Principal capacity.</p>}</div>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">Quota Reservations</h2>
            <div className="mt-4 space-y-3">
              {reservations.length ? reservations.map((item, index) => <article key={text(item.id ?? index)} className="rounded-lg bg-neutral-950 p-3 text-sm"><div className="flex justify-between gap-3"><strong>{dimensionLabel(item.dimension)}</strong><code>{text(item.heldAmount ?? item.amount ?? item.reservedAmount)} {text(item.unit ?? record(item.dimension).unit)}</code></div><p className="mt-1 text-xs text-neutral-500">Run {text(item.runId)} · {text(item.state)} · Policy revision {text(item.policyRevisionId)}</p></article>) : <p className="text-sm text-neutral-500">No active Quota Reservations.</p>}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-lg font-medium">Quota Waits &amp; resumptions</h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {waits.length ? waits.map((item, index) => {
              const evidence = waitEvidence(item);
              const status = String(item.status ?? item.state ?? "waiting");
              const eligibility = record(item.eligibility);
              const eligibleAt = item.eligibleAt ?? eligibility.eligibleAt ?? evidence.eligibleAt;
              return <article key={text(item.waitId ?? item.id ?? index)} className="rounded-lg bg-neutral-950 p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong>Run {text(item.runId)}</strong><span className={status === "waiting" ? "text-amber-300" : status === "resumed" ? "text-emerald-300" : "text-neutral-400"}>{status}</span></div><p className="mt-2 text-xs text-neutral-400">{text(item.reasonCode ?? evidence.reasonCode ?? evidence.condition)} · {dimensionLabel(evidence.dimension ?? item.dimension)}</p><p className="mt-1 text-xs text-neutral-500">Requested {text(evidence.requested ?? item.requestedAmount)} · available {text(evidence.available ?? item.availableAmount)} · eligible {text(eligibleAt)}</p><p className="mt-1 text-xs text-neutral-500">Policy {text(evidence.policyId ?? item.policyId)} / {text(evidence.policyRevisionId ?? item.policyRevisionId)} · reservations {text(item.reservationId ?? records(item.resolutionReservationIds)[0] ?? (Array.isArray(item.resolutionReservationIds) ? item.resolutionReservationIds.join(", ") : null))}</p>{status === "resumed" ? <p className="mt-2 text-xs text-emerald-300">Resumed: {text(item.resumeReason ?? item.resolutionReason)} by {resumeActorLabel(item.resumedBy)} at {text(item.resumedAt ?? item.resolvedAt)}</p> : null}{status === "waiting" ? <button type="button" onClick={() => void resumeWait(item)} className="mt-3 rounded-md border border-sky-800 px-3 py-2 text-xs text-sky-200 hover:bg-sky-950">Re-evaluate and resume</button> : null}</article>;
            }) : <p className="text-sm text-neutral-500">No Quota Waits.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
