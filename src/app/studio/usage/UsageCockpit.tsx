"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { TechnicalBlock, TechnicalCode } from "@/components/ui/technical-data";
import { getActiveWorkspaceId, invokeUsageApplicationCapability } from "@/lib/studio/client";

type JsonRecord = Record<string, unknown>;

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function value(row: JsonRecord, key: string): string {
  const found = row[key];
  return found === null || found === undefined ? "—" : String(found);
}

function cursor(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function UsageCockpit() {
  const t = useTranslations("runtimeUi.usage");
  const [summary, setSummary] = useState<JsonRecord>({});
  const [usage, setUsage] = useState<JsonRecord[]>([]);
  const [valuations, setValuations] = useState<JsonRecord[]>([]);
  const [events, setEvents] = useState<JsonRecord[]>([]);
  const [usageCursor, setUsageCursor] = useState<string | null>(null);
  const [valuationCursor, setValuationCursor] = useState<string | null>(null);
  const [eventCursor, setEventCursor] = useState<string | null>(null);
  const [agentView, setAgentView] = useState<JsonRecord | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!getActiveWorkspaceId()) throw new Error(t("errors.workspace"));
    const [summaryResult, usageResult, valuationResult, eventResult] = await Promise.all([
      invokeUsageApplicationCapability("usage_summaries.get@1"),
      invokeUsageApplicationCapability("usage_records.list@1", { limit: 50 }),
      invokeUsageApplicationCapability("cost_valuations.list@1", { limit: 50 }),
      invokeUsageApplicationCapability("usage_events.list@1", { limit: 50 }),
    ]);
    setSummary(summaryResult);
    setUsage(records(usageResult.items));
    setValuations(records(valuationResult.items));
    setEvents(records(eventResult.items));
    setUsageCursor(cursor(usageResult.nextCursor));
    setValuationCursor(cursor(valuationResult.nextCursor));
    setEventCursor(cursor(eventResult.nextCursor));
  }, [t]);

  useEffect(() => {
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [refresh]);

  async function loadAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const principalId = String(new FormData(event.currentTarget).get("principalId") ?? "").trim();
    if (!principalId) return;
    try {
      setAgentView(await invokeUsageApplicationCapability("agent_usage.get@1", { principalId }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errors.agent"));
    }
  }

  async function loadMoreUsage() {
    if (!usageCursor) return;
    const result = await invokeUsageApplicationCapability("usage_records.list@1", { limit: 50, cursor: usageCursor });
    setUsage((current) => [...current, ...records(result.items)]);
    setUsageCursor(cursor(result.nextCursor));
  }

  async function loadMoreValuations() {
    if (!valuationCursor) return;
    const result = await invokeUsageApplicationCapability("cost_valuations.list@1", { limit: 50, cursor: valuationCursor });
    setValuations((current) => [...current, ...records(result.items)]);
    setValuationCursor(cursor(result.nextCursor));
  }

  async function loadMoreEvents() {
    if (!eventCursor) return;
    const result = await invokeUsageApplicationCapability("usage_events.list@1", { limit: 50, cursor: eventCursor });
    setEvents((current) => [...current, ...records(result.items)]);
    setEventCursor(cursor(result.nextCursor));
  }

  const costs = records(summary.costSubtotals);
  const quantities = records(summary.quantityTotals);
  const complete = summary.complete === true;

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-8 text-neutral-100">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-400">{t("eyebrow")}</p>
            <h1 className="mt-2 text-3xl font-semibold">{t("title")}</h1>
            <p className="mt-2 max-w-2xl text-sm text-neutral-400">{t("description")}</p>
          </div>
          <button type="button" onClick={() => void refresh().catch((cause) => setError(String(cause)))} className="rounded-md border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900">{t("refresh")}</button>
        </header>

        {error ? <p role="alert" className="rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-200">{error}</p> : null}

        <section aria-labelledby="usage-overview" className="grid gap-4 md:grid-cols-3">
          <h2 id="usage-overview" className="sr-only">{t("overview")}</h2>
          <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <p className="text-xs uppercase tracking-wider text-neutral-500">{t("certainty")}</p>
            <p className={`mt-2 text-xl font-medium ${complete ? "text-emerald-300" : "text-amber-300"}`}>{complete ? t("complete") : t("containsUnknowns")}</p>
            <p className="mt-1 text-sm text-neutral-400">{t("unknownValuations", { count: value(summary, "unknownValuationCount") })}</p>
          </article>
          <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-5 md:col-span-2">
            <p className="text-xs uppercase tracking-wider text-neutral-500">{t("knownCosts")}</p>
            <div className="mt-2 flex flex-wrap gap-4">{costs.length ? costs.map((cost) => <TechnicalCode key={value(cost, "currency")} className="text-xl">{value(cost, "amount")} {value(cost, "currency")}</TechnicalCode>) : <span className="text-neutral-400">{t("noKnownCost")}</span>}</div>
          </article>
        </section>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-lg font-medium">{t("quantityTotals")}</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">{quantities.map((item) => <div key={`${value(item, "dimension")}:${value(item, "source")}`} className="rounded-lg bg-neutral-950 p-3"><TechnicalCode className="text-xs text-neutral-500">{value(item, "dimension")} · {value(item, "source")}</TechnicalCode><TechnicalCode className="mt-1 block">{value(item, "quantity")} {value(item, "unit")}</TechnicalCode>{Number(item.unknownCount ?? 0) > 0 ? <p className="mt-1 text-xs text-amber-300">{t("unknownCount", { count: String(item.unknownCount) })}</p> : null}</div>)}</div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5"><h2 className="text-lg font-medium">{t("records")}</h2><div className="mt-4 space-y-3">{usage.map((item) => { const binding = item.binding as JsonRecord | undefined; return <article key={value(item, "id")} className="rounded-lg bg-neutral-950 p-3 text-sm"><div className="flex justify-between gap-3"><TechnicalCode>{value(item, "dimension")}</TechnicalCode><TechnicalCode className={item.quantity === null ? "text-amber-300" : "text-emerald-300"}>{value(item, "quantity")}</TechnicalCode></div><p className="mt-2 text-xs text-neutral-500">{t.rich("recordBinding", { run: () => <TechnicalCode>{binding ? value(binding, "runId") : "—"}</TechnicalCode>, source: () => <TechnicalCode>{value(item, "source")}</TechnicalCode>, artifact: () => <TechnicalCode>{value(item, "directArtifactId")}</TechnicalCode> })}</p></article>; })}</div>{usageCursor ? <button type="button" onClick={() => void loadMoreUsage().catch((cause) => setError(String(cause)))} className="mt-4 rounded-md border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">{t("loadMoreUsage")}</button> : null}</div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5"><h2 className="text-lg font-medium">{t("valuations")}</h2><div className="mt-4 space-y-3">{valuations.map((item) => <article key={value(item, "id")} className="rounded-lg bg-neutral-950 p-3 text-sm"><div className="flex justify-between gap-3"><TechnicalCode>{value(item, "basis")} · {value(item, "pricingSource")}</TechnicalCode><TechnicalCode className={item.amount === null ? "text-amber-300" : "text-emerald-300"}>{value(item, "amount")} {item.currency ? value(item, "currency") : ""}</TechnicalCode></div><p className="mt-2 text-xs text-neutral-500">{t.rich("valuationBinding", { snapshots: () => <TechnicalCode>{Array.isArray(item.pricingSnapshotIds) ? item.pricingSnapshotIds.length : 0}</TechnicalCode>, supersedes: () => <TechnicalCode>{value(item, "supersedesCostValuationId")}</TechnicalCode> })}</p></article>)}</div>{valuationCursor ? <button type="button" onClick={() => void loadMoreValuations().catch((cause) => setError(String(cause)))} className="mt-4 rounded-md border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">{t("loadMoreValuations")}</button> : null}</div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5"><h2 className="text-lg font-medium">{t("events")}</h2><ol className="mt-4 space-y-2">{events.map((item) => <li key={value(item, "id")} className="border-s border-neutral-700 ps-3 text-sm"><TechnicalCode>{value(item, "type")}</TechnicalCode><time dir="ltr" className="ms-2 inline-block text-xs text-neutral-500 [unicode-bidi:isolate]">{value(item, "occurredAt")}</time></li>)}</ol>{eventCursor ? <button type="button" onClick={() => void loadMoreEvents().catch((cause) => setError(String(cause)))} className="mt-4 rounded-md border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">{t("loadMoreEvents")}</button> : null}</div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5"><h2 className="text-lg font-medium">{t("agentTitle")}</h2><form onSubmit={loadAgent} className="mt-4 flex gap-2"><input name="principalId" aria-label={t("principalId")} required className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" placeholder={t("principalPlaceholder")} dir="ltr" /><button className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950">{t("load")}</button></form>{agentView ? <TechnicalBlock className="mt-4 max-h-72 rounded-lg bg-neutral-950 p-3 text-xs text-neutral-300">{JSON.stringify(agentView, null, 2)}</TechnicalBlock> : <p className="mt-3 text-sm text-neutral-500">{t("agentDescription")}</p>}</div>
        </section>
      </div>
    </main>
  );
}
