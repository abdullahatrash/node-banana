"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  getActiveWorkspaceId,
  invokeBudgetApplicationCapability,
} from "@/lib/studio/client";

type JsonRecord = Record<string, unknown>;

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown): string {
  return value === null || value === undefined ? "—" : String(value);
}

export function BudgetCockpit() {
  const [policies, setPolicies] = useState<JsonRecord[]>([]);
  const [pricingOverrides, setPricingOverrides] = useState<JsonRecord[]>([]);
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
      throw new Error("Select a Workspace before managing budgets.");
    }
    const [policyResult, pricingResult, controlResult] = await Promise.all([
      invokeBudgetApplicationCapability("budget_policies.list@1"),
      invokeBudgetApplicationCapability("pricing_overrides.list@1"),
      invokeBudgetApplicationCapability("spend_controls.get@1"),
    ]);
    setPolicies(records(policyResult.items));
    setPricingOverrides(records(pricingResult.items));
    setSuspended(controlResult.suspended === true);
  }, []);

  useEffect(() => {
    void refresh().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [refresh]);

  async function createPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const treatment = String(data.get("unknownPriceTreatment"));
    const principalId = String(data.get("principalId") ?? "").trim();
    const allowance = String(data.get("unknownPriceAllowance") ?? "").trim();
    const input = {
      principalId: principalId || null,
      currency: String(data.get("currency") ?? "").trim().toUpperCase(),
      period: data.get("period"),
      timezone: String(data.get("timezone") ?? "").trim(),
      warningThreshold: String(data.get("warningThreshold") ?? "").trim(),
      hardLimit: String(data.get("hardLimit") ?? "").trim(),
      unknownPriceTreatment: treatment,
      unknownPriceAllowance: treatment === "fixed_allowance" ? allowance : null,
    };
    const scope = "budget_policy_revisions.create@1";
    try {
      await invokeBudgetApplicationCapability(scope, input, {
        idempotencyKey: stableSubmitKey(scope, input),
      });
      submitKeys.current.delete(scope);
      form.reset();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Budget policy creation failed.");
    }
  }

  async function createPricingOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = {
      provider: String(data.get("provider") ?? "").trim(),
      providerOperation: String(data.get("providerOperation") ?? "").trim(),
      model: String(data.get("model") ?? "").trim(),
      serviceTier: String(data.get("serviceTier") ?? "").trim(),
      dimension: String(data.get("dimension") ?? "").trim(),
      unit: data.get("unit"),
      price: String(data.get("price") ?? "").trim(),
      currency: String(data.get("currency") ?? "").trim().toUpperCase(),
      perQuantity: String(data.get("perQuantity") ?? "").trim(),
      runCeiling: String(data.get("runCeiling") ?? "").trim(),
      sourceRef: String(data.get("sourceRef") ?? "").trim(),
      effectiveFrom: String(data.get("effectiveFrom") ?? "").trim(),
    };
    const scope = "pricing_overrides.create@1";
    try {
      await invokeBudgetApplicationCapability(scope, input, {
        idempotencyKey: stableSubmitKey(scope, input),
      });
      submitKeys.current.delete(scope);
      form.reset();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pricing Override creation failed.");
    }
  }

  async function revokePricingOverride(overrideId: string) {
    setError("");
    try {
      await invokeBudgetApplicationCapability("pricing_overrides.revoke@1", {
        overrideId,
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pricing Override revocation failed.");
    }
  }

  async function setSpendControl(nextSuspended: boolean) {
    setError("");
    if (!reason.trim()) {
      setError("Record a reason before changing emergency spend controls.");
      return;
    }
    try {
      await invokeBudgetApplicationCapability(
        nextSuspended ? "spend_controls.suspend@1" : "spend_controls.resume@1",
        { reason: reason.trim() },
      );
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
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-400">Runtime controls</p>
            <h1 className="mt-2 text-3xl font-semibold">Budgets &amp; Pricing</h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-400">Versioned guardrails for external provider spend. Reservations authorize bounded execution; they are not provider funds or invoices.</p>
          </div>
          <button type="button" onClick={() => void refresh().catch((cause) => setError(String(cause)))} className="rounded-md border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900">Refresh</button>
        </header>

        {error ? <p role="alert" className="rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-200">{error}</p> : null}

        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">Emergency spend control</h2>
              <p className={`mt-1 text-sm ${suspended ? "text-red-300" : "text-emerald-300"}`}>{suspended ? "Provider spend suspended" : "Provider spend active"}</p>
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
            <h2 className="text-lg font-medium">Budget policies</h2>
            <div className="mt-4 space-y-3">
              {policies.length ? policies.map((item) => {
                const policy = record(item.policy);
                const revision = record(item.revision);
                return <article key={text(policy.id)} className="rounded-lg bg-neutral-950 p-3 text-sm"><div className="flex justify-between gap-3"><strong>{text(policy.scope)}</strong><code>{text(revision.hardLimit)} {text(policy.currency)}</code></div><p className="mt-1 text-xs text-neutral-500">{text(policy.period)} · {text(policy.timezone)} · warning {text(revision.warningThreshold)}</p></article>;
              }) : <p className="text-sm text-neutral-500">No Budget Policy configured.</p>}
            </div>
          </div>

          <form onSubmit={createPolicy} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">Create policy revision</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input name="principalId" aria-label="Agent Principal ID" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" placeholder="Agent Principal ID (blank = Workspace)" />
              <input name="currency" aria-label="Budget currency" required defaultValue="USD" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
              <select name="period" aria-label="Budget period" defaultValue="calendar_month" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="calendar_day">Calendar day</option><option value="calendar_week">Calendar week</option><option value="calendar_month">Calendar month</option><option value="lifetime">Lifetime</option></select>
              <input name="timezone" aria-label="Budget timezone" required defaultValue="UTC" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
              <input name="warningThreshold" aria-label="Warning threshold" required inputMode="decimal" placeholder="80" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
              <input name="hardLimit" aria-label="Hard limit" required inputMode="decimal" placeholder="100" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
              <select name="unknownPriceTreatment" aria-label="Unknown price treatment" defaultValue="deny" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="deny">Deny unknown price</option><option value="fixed_allowance">Fixed allowance</option></select>
              <input name="unknownPriceAllowance" aria-label="Unknown price allowance" inputMode="decimal" placeholder="Optional fixed allowance" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
            </div>
            <button className="mt-4 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950">Create revision</button>
          </form>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">Pricing Overrides</h2>
            <div className="mt-4 space-y-3">
              {pricingOverrides.length ? pricingOverrides.map((item) => <article key={text(item.id)} className="rounded-lg bg-neutral-950 p-3 text-sm"><div className="flex justify-between gap-3"><span>{text(item.provider)} · {text(item.model)}</span><code>{text(item.price)} {text(item.currency)} / {text(item.perQuantity)} {text(item.unit)}</code></div><p className="mt-1 text-xs text-neutral-500">{text(item.dimension)} · {text(item.status)} · ceiling {text(item.runCeiling)}</p>{item.status === "active" ? <button type="button" onClick={() => void revokePricingOverride(String(item.id))} className="mt-2 text-xs text-red-300 hover:text-red-200">Revoke</button> : null}</article>) : <p className="text-sm text-neutral-500">No Workspace Pricing Override configured.</p>}
            </div>
          </div>

          <form onSubmit={createPricingOverride} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">Create Pricing Override</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[["provider", "Provider"], ["providerOperation", "Provider operation"], ["model", "Model/version"], ["serviceTier", "Service tier"], ["dimension", "Usage dimension@version"], ["price", "Exact price"], ["currency", "Currency"], ["perQuantity", "Per quantity"], ["runCeiling", "Run ceiling"], ["sourceRef", "Source reference"], ["effectiveFrom", "Effective ISO time"]].map(([name, label]) => <input key={name} name={name} aria-label={label} required defaultValue={name === "currency" ? "USD" : name === "serviceTier" ? "standard" : name === "perQuantity" ? "1" : undefined} className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" placeholder={label} />)}
              <select name="unit" aria-label="Pricing unit" defaultValue="count" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="count">count</option><option value="byte">byte</option><option value="millisecond">millisecond</option><option value="megapixel">megapixel</option></select>
            </div>
            <button className="mt-4 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950">Create override</button>
          </form>
        </section>
      </div>
    </main>
  );
}
