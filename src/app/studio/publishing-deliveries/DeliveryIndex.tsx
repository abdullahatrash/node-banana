"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getActiveWorkspaceId,
  invokeDeliveryOperationsApplicationCapability,
  type DeliveryOperationsResultMap,
  StudioApiError,
} from "@/lib/studio/client";
import { WorkspaceSpendControl } from "./WorkspaceSpendControl";

type Delivery = DeliveryOperationsResultMap["publishing_deliveries.list@2"]["items"][number];

export function DeliveryIndex() {
  const t = useTranslations("runtimeUi.deliveries.index");
  const [items, setItems] = useState<Delivery[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<Delivery["state"] | "">("");
  const [loading, setLoading] = useState(true);
  const [hasActiveWorkspace, setHasActiveWorkspace] = useState(false);
  const [authLost, setAuthLost] = useState(false);
  const [error, setError] = useState("");
  const [paging, setPaging] = useState(false);
  const requestGeneration = useRef(0);
  const pagingActive = useRef(false);
  const loseAuthorization = useCallback(() => {
    setItems([]);
    setCursor(null);
    setAuthLost(true);
  }, []);

  const load = useCallback(async (nextCursor: string | undefined, token: number) => {
    if (!getActiveWorkspaceId()) {
      setError(t("errors.workspace"));
      setLoading(false);
      return;
    }
    if (nextCursor && pagingActive.current) return;
    if (nextCursor) {
      pagingActive.current = true;
      setPaging(true);
    }
    try {
      const result = await invokeDeliveryOperationsApplicationCapability(
        "publishing_deliveries.list@2",
        { limit: 50, ...(state ? { state } : {}), ...(nextCursor ? { cursor: nextCursor } : {}) },
      );
      if (token !== requestGeneration.current) return;
      setItems((current) => {
        if (!nextCursor) return result.items;
        const deduplicated = new Map(current.map((item) => [item.id, item]));
        for (const item of result.items) deduplicated.set(item.id, item);
        return [...deduplicated.values()];
      });
      setCursor(result.nextCursor);
      setError("");
    } catch (cause) {
      if (token !== requestGeneration.current) return;
      if (cause instanceof StudioApiError && (cause.status === 401 || cause.status === 403)) {
        setItems([]);
        setCursor(null);
        setAuthLost(true);
      } else {
        setError(cause instanceof Error ? cause.message : t("errors.unavailable"));
      }
    } finally {
      if (nextCursor) {
        pagingActive.current = false;
        if (token === requestGeneration.current) setPaging(false);
      }
      if (token === requestGeneration.current) setLoading(false);
    }
  }, [state, t]);

  useEffect(() => {
    setHasActiveWorkspace(Boolean(getActiveWorkspaceId()));
    const token = ++requestGeneration.current;
    setLoading(true);
    setItems([]);
    setCursor(null);
    setPaging(false);
    pagingActive.current = false;
    setAuthLost(false);
    void load(undefined, token);
  }, [load]);

  if (authLost) {
    return <main className="min-h-screen bg-neutral-950 p-8 text-neutral-100"><h1 className="text-2xl font-semibold">{t("unavailableTitle")}</h1><p role="alert" className="mt-3 text-amber-200">{t("authorizationLost")}</p></main>;
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-5 py-8 text-neutral-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <header><p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-400">{t("eyebrow")}</p><h1 className="mt-2 text-3xl font-semibold">{t("title")}</h1><p className="mt-2 text-neutral-400">{t("description")}</p></header>
        <section aria-label={t("filters")} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"><label className="text-sm">{t("currentState")}<select value={state} onChange={(event) => setState(event.target.value as typeof state)} className="ms-3 rounded border border-neutral-700 bg-neutral-950 px-3 py-2"><option value="">{t("allStates")}</option>{(["scheduled", "blocked", "dispatching", "confirmation_pending", "succeeded", "failed_transient", "failed_terminal", "outcome_unknown", "cancelled"] as const).map((value) => <option key={value} value={value}>{t(`states.${value}`)}</option>)}</select></label></section>
        {loading ? <p role="status">{t("loading")}</p> : null}
        {error ? <p role="alert" className="rounded border border-red-900 bg-red-950/40 p-4 text-red-200">{error}</p> : null}
        {hasActiveWorkspace ? <WorkspaceSpendControl onAuthorizationLoss={loseAuthorization} /> : null}
        <section aria-label={t("results")} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5"><h2 className="text-lg font-medium">{t("canonical")}</h2><ul className="mt-4 divide-y divide-neutral-800">{items.map((delivery) => <li key={delivery.id} className="py-4"><Link href={`/studio/publishing-deliveries/${encodeURIComponent(delivery.id)}`} className="block rounded p-2 hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-sky-400"><div className="flex flex-wrap justify-between gap-3"><strong><bdi>{delivery.id}</bdi></strong><span>{t(`states.${delivery.state}`)}</span></div><p className="mt-2 text-sm text-neutral-400">{t("summary", { target: delivery.targetId, publishAt: delivery.publishAt, completed: delivery.externallyCompleted === null ? t("unknown") : String(delivery.externallyCompleted) })}</p></Link></li>)}</ul>{!loading && items.length === 0 ? <p className="mt-4 text-neutral-500">{t("empty")}</p> : null}{cursor ? <button type="button" disabled={paging} aria-busy={paging} onClick={() => void load(cursor, requestGeneration.current)} className="mt-4 rounded border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40">{paging ? t("loadingMore") : t("loadMore")}</button> : null}</section>
      </div>
    </main>
  );
}
