"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
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

function dimensionLabel(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  const dimension = record(value);
  return [dimension.kind, dimension.key].filter(Boolean).map(String).join(" · ") || fallback;
}

function waitEvidence(wait: JsonRecord): JsonRecord {
  return records(wait.evidence)[0] ?? record(wait.eligibility);
}

function resumeActorLabel(value: unknown, labels: { human: string; agent: string; system: string }): string {
  const actor = record(value);
  if (actor.kind === "human") return `${labels.human} ${text(actor.userId)}`;
  if (actor.kind === "principal") return `${labels.agent} ${text(actor.principalId)}`;
  if (actor.kind === "system") return labels.system;
  return "—";
}

export function QuotaCockpit() {
  const t = useTranslations("runtimeUi.quotas");
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
      throw new Error(t("errors.workspace"));
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
  }, [t]);

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
      setError(cause instanceof Error ? cause.message : t("errors.resume"));
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
      setError(cause instanceof Error ? cause.message : t("errors.capacity"));
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
      setError(cause instanceof Error ? cause.message : t("errors.policy"));
    }
  }

  async function setSpendControl(nextSuspended: boolean) {
    setError("");
    if (!reason.trim()) {
      setError(t("errors.reason"));
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
      setError(cause instanceof Error ? cause.message : t("errors.spend"));
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-8 text-neutral-100">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-400">{t("eyebrow")}</p>
            <h1 className="mt-2 text-3xl font-semibold">{t("title")}</h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-400">{t("description")}</p>
          </div>
          <button type="button" onClick={() => void refresh().catch((cause) => setError(String(cause)))} className="rounded-md border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900">{t("refresh")}</button>
        </header>

        {error ? <p role="alert" className="rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-200">{error}</p> : null}

        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">{t("spend.title")}</h2>
              <p className={`mt-1 text-sm ${suspended ? "text-red-300" : "text-emerald-300"}`}>{suspended ? t("spend.blocked") : t("spend.enabled")}</p>
              <p className="mt-1 text-xs text-neutral-500">{t("spend.help")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input aria-label={t("spend.reasonLabel")} value={reason} onChange={(event) => setReason(event.target.value)} className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" placeholder={t("spend.reasonPlaceholder")} />
              <button type="button" onClick={() => void setSpendControl(true)} disabled={suspended} className="rounded-md border border-red-800 px-3 py-2 text-sm disabled:opacity-40">{t("spend.suspend")}</button>
              <button type="button" onClick={() => void setSpendControl(false)} disabled={!suspended} className="rounded-md border border-emerald-800 px-3 py-2 text-sm disabled:opacity-40">{t("spend.resume")}</button>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">{t("policies.title")}</h2>
            <div className="mt-4 space-y-3">
              {policies.length ? policies.map((item, index) => {
                const policy = record(item.policy);
                const revision = record(item.revision);
                const dimension = revision.dimension ?? policy.dimension ?? item.dimension;
                return <article key={text(policy.id ?? item.id ?? index)} className="rounded-lg bg-neutral-950 p-3 text-sm"><div className="flex justify-between gap-3"><strong>{dimensionLabel(dimension, t("capacityFallback"))}</strong><code dir="ltr">{text(revision.hardLimit)} {text(policy.unit)}</code></div><p className="mt-1 text-xs text-neutral-500">{text(policy.scope)} · {text(policy.kind)} / {text(policy.boundary)} · {text(policy.window)} · {text(policy.timezone)}</p><p className="mt-1 text-xs text-neutral-500">{t("policies.rule", { rule: text(policy.reservationRule), exhaustion: text(revision.exhaustionBehavior), warning: text(revision.warningThreshold) })}</p></article>;
              }) : <p className="text-sm text-neutral-500">{t("policies.empty")}</p>}
            </div>
          </div>

          <form onSubmit={createPolicy} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">{t("create.title")}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input name="principalId" aria-label={t("create.principalLabel")} className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" placeholder={t("create.principalPlaceholder")} dir="ltr" />
              <select name="kind" aria-label={t("create.kindLabel")} defaultValue="concurrency" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="admission">{t("kind.admission")}</option><option value="concurrency">{t("kind.concurrency")}</option><option value="rate">{t("kind.rate")}</option><option value="storage">{t("kind.storage")}</option><option value="usage">{t("kind.usage")}</option></select>
              <select name="boundary" aria-label={t("create.boundaryLabel")} defaultValue="run_concurrency" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="run_admission">{t("boundary.runAdmission")}</option><option value="run_concurrency">{t("boundary.runConcurrency")}</option><option value="provider_effect">{t("boundary.providerEffect")}</option><option value="artifact_storage">{t("boundary.artifactStorage")}</option><option value="usage_settlement">{t("boundary.usageSettlement")}</option></select>
              <input name="dimension" aria-label={t("create.dimensionLabel")} required defaultValue="runtime.concurrent_runs@1" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" dir="ltr" />
              <select name="unit" aria-label={t("create.unitLabel")} defaultValue="count" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="count">{t("unit.count")}</option><option value="byte">{t("unit.byte")}</option><option value="millisecond">{t("unit.millisecond")}</option><option value="megapixel">{t("unit.megapixel")}</option></select>
              <select name="window" aria-label={t("create.windowLabel")} defaultValue="concurrent" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="concurrent">{t("window.concurrent")}</option><option value="calendar_minute">{t("window.minute")}</option><option value="calendar_hour">{t("window.hour")}</option><option value="calendar_day">{t("window.day")}</option><option value="calendar_week">{t("window.week")}</option><option value="calendar_month">{t("window.month")}</option><option value="lifetime">{t("window.lifetime")}</option></select>
              <input name="timezone" aria-label={t("create.timezoneLabel")} required defaultValue="UTC" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" dir="ltr" />
              <select name="reservationRule" aria-label={t("create.ruleLabel")} defaultValue="release_on_terminal" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="consume">{t("rule.consume")}</option><option value="release_on_terminal">{t("rule.terminal")}</option><option value="release_on_transition">{t("rule.transition")}</option></select>
              <input name="warningThreshold" aria-label={t("create.warningLabel")} required inputMode="decimal" placeholder="8" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" dir="ltr" />
              <input name="hardLimit" aria-label={t("create.limitLabel")} required inputMode="decimal" placeholder="10" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" dir="ltr" />
              <select name="exhaustionBehavior" aria-label={t("create.exhaustionLabel")} defaultValue="wait" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="wait">{t("exhaustion.wait")}</option><option value="deny">{t("exhaustion.deny")}</option></select>
            </div>
            <button className="mt-4 rounded-md bg-sky-400 px-4 py-2 text-sm font-medium text-neutral-950">{t("create.submit")}</button>
          </form>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">{t("effective.title")}</h2>
            <form onSubmit={loadEffectiveCapacity} className="mt-4 flex gap-2"><input name="principalId" aria-label={t("effective.principalLabel")} required className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" placeholder={t("effective.principalPlaceholder")} dir="ltr" /><button className="rounded-md border border-sky-800 px-3 py-2 text-sm text-sky-200">{t("effective.load")}</button></form>
            <div className="mt-4 space-y-3">{capacities.length ? capacities.map((item, index) => { const policy = record(item.policy); const revision = record(item.revision); const warning = item.warning === true; const exhausted = item.exhausted === true; return <article key={text(policy.id ?? index)} className="rounded-lg bg-neutral-950 p-3 text-sm"><div className="flex justify-between gap-3"><strong>{dimensionLabel(policy.dimension, t("capacityFallback"))}</strong><code dir="ltr">{text(item.available)} / {text(revision.hardLimit)} {text(policy.unit)}</code></div><p className="mt-1 text-xs text-neutral-500">{t("effective.summary", { committed: text(item.committed), evaluated: text(item.evaluatedAt) })}</p>{warning ? <p className="mt-2 text-xs text-amber-300">{t("effective.warning")}</p> : null}{exhausted ? <p className="mt-1 text-xs text-red-300">{t("effective.exhausted", { ids: text(Array.isArray(item.blockingReservationIds) ? item.blockingReservationIds.join(", ") : item.blockingReservationIds) })}</p> : null}</article>; }) : <p className="text-sm text-neutral-500">{t("effective.empty")}</p>}</div>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">{t("reservations.title")}</h2>
            <div className="mt-4 space-y-3">
              {reservations.length ? reservations.map((item, index) => <article key={text(item.id ?? index)} className="rounded-lg bg-neutral-950 p-3 text-sm"><div className="flex justify-between gap-3"><strong>{dimensionLabel(item.dimension, t("capacityFallback"))}</strong><code dir="ltr">{text(item.heldAmount ?? item.amount ?? item.reservedAmount)} {text(item.unit ?? record(item.dimension).unit)}</code></div><p className="mt-1 text-xs text-neutral-500">{t("reservations.summary", { run: text(item.runId), state: text(item.state), revision: text(item.policyRevisionId) })}</p></article>) : <p className="text-sm text-neutral-500">{t("reservations.empty")}</p>}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-lg font-medium">{t("waits.title")}</h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {waits.length ? waits.map((item, index) => {
              const evidence = waitEvidence(item);
              const status = String(item.status ?? item.state ?? "waiting");
              const eligibility = record(item.eligibility);
              const eligibleAt = item.eligibleAt ?? eligibility.eligibleAt ?? evidence.eligibleAt;
              return <article key={text(item.waitId ?? item.id ?? index)} className="rounded-lg bg-neutral-950 p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{t("waits.run", { run: text(item.runId) })}</strong><span className={status === "waiting" ? "text-amber-300" : status === "resumed" ? "text-emerald-300" : "text-neutral-400"}>{status}</span></div><p className="mt-2 text-xs text-neutral-400">{text(item.reasonCode ?? evidence.reasonCode ?? evidence.condition)} · {dimensionLabel(evidence.dimension ?? item.dimension, t("capacityFallback"))}</p><p className="mt-1 text-xs text-neutral-500">{t("waits.request", { requested: text(evidence.requested ?? item.requestedAmount), available: text(evidence.available ?? item.availableAmount), eligible: text(eligibleAt) })}</p><p className="mt-1 text-xs text-neutral-500">{t("waits.policy", { policy: text(evidence.policyId ?? item.policyId), revision: text(evidence.policyRevisionId ?? item.policyRevisionId), reservations: text(item.reservationId ?? records(item.resolutionReservationIds)[0] ?? (Array.isArray(item.resolutionReservationIds) ? item.resolutionReservationIds.join(", ") : null)) })}</p>{status === "resumed" ? <p className="mt-2 text-xs text-emerald-300">{t("waits.resumed", { reason: text(item.resumeReason ?? item.resolutionReason), actor: resumeActorLabel(item.resumedBy, { human: t("actor.human"), agent: t("actor.agent"), system: t("actor.system") }), time: text(item.resumedAt ?? item.resolvedAt) })}</p> : null}{status === "waiting" ? <button type="button" onClick={() => void resumeWait(item)} className="mt-3 rounded-md border border-sky-800 px-3 py-2 text-xs text-sky-200 hover:bg-sky-950">{t("waits.resume")}</button> : null}</article>;
            }) : <p className="text-sm text-neutral-500">{t("waits.empty")}</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
