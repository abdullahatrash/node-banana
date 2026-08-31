"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  getActiveWorkspaceId,
  invokeObservabilityApplicationCapability,
} from "@/lib/studio/client";

type JsonRecord = Record<string, unknown>;
type ResourceKind =
  | "run"
  | "run_event"
  | "artifact"
  | "usage_record"
  | "cost_valuation"
  | "budget_reservation"
  | "quota_reservation"
  | "quota_wait";

const projectionByResource: Record<ResourceKind, string> = {
  run: "run_summary",
  run_event: "run_event_summary",
  artifact: "artifact_metadata",
  usage_record: "usage_summary",
  cost_valuation: "cost_summary",
  budget_reservation: "budget_summary",
  quota_reservation: "quota_reservation_summary",
  quota_wait: "quota_wait_summary",
};

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
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}

function defaultExpiry(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toISOString().slice(0, 16);
}

export function ObservabilityCockpit() {
  const [metrics, setMetrics] = useState<JsonRecord[]>([]);
  const [metricCursor, setMetricCursor] = useState<string | null>(null);
  const [retention, setRetention] = useState<JsonRecord>({});
  const [grants, setGrants] = useState<JsonRecord[]>([]);
  const [selectedTraceGrantId, setSelectedTraceGrantId] = useState("");
  const [selectedBundleGrantId, setSelectedBundleGrantId] = useState("");
  const [trace, setTrace] = useState<JsonRecord | null>(null);
  const [bundle, setBundle] = useState<JsonRecord | null>(null);
  const [bundlePayload, setBundlePayload] = useState<JsonRecord | null>(null);
  const [bundleAudit, setBundleAudit] = useState<JsonRecord[]>([]);
  const [selections, setSelections] = useState<Array<{
    resourceKind: ResourceKind;
    resourceId: string;
    projectionKind: string;
  }>>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitKeys = useRef(new Map<string, { payload: string; key: string }>());

  const stableKey = useCallback((scope: string, input: Record<string, unknown>) => {
    const payload = JSON.stringify(input);
    const current = submitKeys.current.get(scope);
    if (current?.payload === payload) return current.key;
    const key = crypto.randomUUID();
    submitKeys.current.set(scope, { payload, key });
    return key;
  }, []);

  const refresh = useCallback(async () => {
    if (!getActiveWorkspaceId()) {
      throw new Error("Select a Workspace before viewing observability.");
    }
    const [metricResult, retentionResult, grantResult] = await Promise.all([
      invokeObservabilityApplicationCapability("operational_metrics.list@1", {
        limit: 50,
        cursor: null,
      }),
      invokeObservabilityApplicationCapability("observability_retention.get@1"),
      invokeObservabilityApplicationCapability("telemetry_operator_grants.list@1", {
        limit: 100,
      }),
    ]);
    setMetrics(records(metricResult.items));
    setMetricCursor(
      typeof metricResult.nextCursor === "string" ? metricResult.nextCursor : null,
    );
    setRetention(record(retentionResult.revision));
    const nextGrants = records(grantResult.items);
    setGrants(nextGrants);
    const traceGrantId = nextGrants.find(
      (grant) => Array.isArray(grant.scopes) && grant.scopes.includes("trace.read"),
    )?.id;
    const bundleGrantId = nextGrants.find(
      (grant) =>
        Array.isArray(grant.scopes) && grant.scopes.includes("support_bundle.read"),
    )?.id;
    setSelectedTraceGrantId(
      typeof traceGrantId === "string" ? traceGrantId : "",
    );
    setSelectedBundleGrantId(
      typeof bundleGrantId === "string" ? bundleGrantId : "",
    );
  }, []);

  useEffect(() => {
    void refresh().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [refresh]);

  useEffect(() => {
    const traceIds = grants
      .filter((grant) => Array.isArray(grant.scopes) && grant.scopes.includes("trace.read"))
      .map((grant) => grant.id)
      .filter((id): id is string => typeof id === "string");
    const bundleIds = grants
      .filter((grant) => Array.isArray(grant.scopes) && grant.scopes.includes("support_bundle.read"))
      .map((grant) => grant.id)
      .filter((id): id is string => typeof id === "string");
    if (!traceIds.includes(selectedTraceGrantId)) {
      setSelectedTraceGrantId(traceIds[0] ?? "");
    }
    if (!bundleIds.includes(selectedBundleGrantId)) {
      setSelectedBundleGrantId(bundleIds[0] ?? "");
    }
  }, [grants, selectedTraceGrantId, selectedBundleGrantId]);

  async function loadMoreMetrics() {
    if (!metricCursor) return;
    const result = await invokeObservabilityApplicationCapability(
      "operational_metrics.list@1",
      { limit: 50, cursor: metricCursor },
    );
    setMetrics((current) => [...current, ...records(result.items)]);
    setMetricCursor(
      typeof result.nextCursor === "string" ? result.nextCursor : null,
    );
  }

  async function updateRetention(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = {
      metricTtlSeconds: Number(data.get("metricTtlSeconds")),
      traceTtlSeconds: Number(data.get("traceTtlSeconds")),
      supportBundleTtlSeconds: Number(data.get("supportBundleTtlSeconds")),
    };
    const scope = "observability_retention.set@1";
    const result = await invokeObservabilityApplicationCapability(scope, input, {
      idempotencyKey: stableKey(scope, input),
    });
    submitKeys.current.delete(scope);
    setRetention(record(result.revision));
    setNotice("Retention policy narrowed.");
  }

  async function issueGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const scopes = [
      data.get("trace") === "on" ? "trace.read" : null,
      data.get("support") === "on" ? "support_bundle.read" : null,
    ].filter((value): value is string => Boolean(value));
    const input = {
      scopes,
      expiresAt: new Date(String(data.get("expiresAt"))).toISOString(),
    };
    const scope = "telemetry_operator_grants.issue@1";
    await invokeObservabilityApplicationCapability(scope, input, {
      idempotencyKey: stableKey(scope, input),
    });
    submitKeys.current.delete(scope);
    await refresh();
  }

  async function revokeGrant(grantId: string) {
    await invokeObservabilityApplicationCapability(
      "telemetry_operator_grants.revoke@1",
      { grantId },
    );
    await refresh();
  }

  async function lookupTrace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = await invokeObservabilityApplicationCapability(
      "diagnostic_traces.get@1",
      {
        operatorTraceRef: String(data.get("operatorTraceRef") ?? "").trim(),
        operatorGrantId: String(data.get("operatorGrantId") ?? "").trim(),
      },
    );
    setTrace(result);
  }

  function addSelection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const resourceKind = String(data.get("resourceKind")) as ResourceKind;
    const resourceId = String(data.get("resourceId") ?? "").trim();
    if (!resourceId) return;
    setSelections((current) => [
      ...current,
      { resourceKind, resourceId, projectionKind: projectionByResource[resourceKind] },
    ]);
    form.reset();
  }

  async function createBundle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      selections,
      purpose: data.get("purpose"),
      consentExpiresAt: new Date(String(data.get("consentExpiresAt"))).toISOString(),
      consentConfirmed: data.get("consentConfirmed") === "on",
    };
    const scope = "support_bundles.create@1";
    const result = await invokeObservabilityApplicationCapability(scope, input, {
      idempotencyKey: stableKey(scope, input),
    });
    submitKeys.current.delete(scope);
    setBundle(result);
    setSelections([]);
    setNotice("Frozen Support Bundle stored with explicit consent.");
  }

  async function lookupBundle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      bundleId: String(data.get("bundleId") ?? "").trim(),
      operatorGrantId: String(data.get("operatorGrantId") ?? "").trim(),
    };
    const payload = await invokeObservabilityApplicationCapability(
      "support_bundles.payload.get@1",
      input,
    );
    const audit = await invokeObservabilityApplicationCapability(
      "support_bundle_audit.list@1",
      { ...input, limit: 100 },
    );
    setBundle(record(payload.bundle));
    setBundlePayload(record(payload.content));
    setBundleAudit(records(audit.items));
  }

  function downloadBundle() {
    if (bundlePayload?.encoding !== "base64" || typeof bundlePayload.data !== "string") return;
    const binary = atob(bundlePayload.data);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${text(bundle?.id)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function revokeBundle() {
    if (typeof bundle?.id !== "string") return;
    await invokeObservabilityApplicationCapability("support_bundles.revoke@1", {
      bundleId: bundle.id,
    });
    setBundle((current) => (current ? { ...current, state: "revoked" } : current));
    setBundlePayload(null);
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-8 text-neutral-100">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-400">Secret-safe runtime operations</p>
            <h1 className="mt-2 text-3xl font-semibold">Observability Cockpit</h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-400">Low-cardinality health, sanitized operator traces, explicit short-lived Support Bundles, retention, and context-bound grants.</p>
          </div>
          <button type="button" onClick={() => void refresh().catch((cause) => setError(String(cause)))} className="rounded-md border border-neutral-700 px-4 py-2 text-sm">Refresh</button>
        </header>

        {error ? <p role="alert" className="rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-200">{error}</p> : null}
        {notice ? <p role="status" className="rounded-md border border-emerald-900 bg-emerald-950/40 p-3 text-sm text-emerald-200">{notice}</p> : null}

        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-lg font-medium">Operational health</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {metrics.map((metric, index) => <article key={`${text(metric.name)}:${index}`} className="rounded-lg bg-neutral-950 p-3"><p className="text-xs text-neutral-500">{text(metric.name)}</p><p className="mt-1 font-mono text-lg">{text(metric.sum)}</p><p className="text-xs text-neutral-500">{records(metric.dimensions).map((dimension) => `${text(dimension.key)}=${text(dimension.value)}`).join(" · ") || "no dimensions"}</p><p className="text-xs text-neutral-500">{text(metric.count)} observations · {text(metric.recordedAt)}</p></article>)}
          </div>
          {metricCursor ? <button type="button" onClick={() => void loadMoreMetrics().catch((cause) => setError(String(cause)))} className="mt-4 rounded-md border border-neutral-700 px-3 py-2 text-sm">Load more</button> : null}
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <form key={text(retention.id)} onSubmit={(event) => void updateRetention(event).catch((cause) => setError(String(cause)))} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">Retention</h2>
            <p className="mt-1 text-xs text-neutral-500">Revisions can only narrow TTLs. Trace max: 30 days. Bundle max: 7 days.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-xs">Metric seconds<input name="metricTtlSeconds" type="number" min="60" defaultValue={Number(retention.metricTtlSeconds ?? 2592000)} className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2" /></label>
              <label className="text-xs">Trace seconds<input name="traceTtlSeconds" type="number" min="60" max="2592000" defaultValue={Number(retention.traceTtlSeconds ?? 86400)} className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2" /></label>
              <label className="text-xs">Bundle seconds<input name="supportBundleTtlSeconds" type="number" min="60" max="604800" defaultValue={Number(retention.supportBundleTtlSeconds ?? 604800)} className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2" /></label>
            </div>
            <button className="mt-4 rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-neutral-950">Save narrower revision</button>
          </form>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">Telemetry Operator Grants</h2>
            <form onSubmit={(event) => void issueGrant(event).catch((cause) => setError(String(cause)))} className="mt-4 space-y-3">
              <div className="flex gap-4 text-sm"><label><input name="trace" type="checkbox" defaultChecked /> Trace read</label><label><input name="support" type="checkbox" defaultChecked /> Bundle read</label></div>
              <input name="expiresAt" aria-label="Grant expiry" type="datetime-local" required defaultValue={defaultExpiry(1)} className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
              <button className="ml-2 rounded-md border border-violet-700 px-3 py-2 text-sm">Issue to me</button>
            </form>
            <ul className="mt-4 space-y-2">{grants.map((grant) => <li key={text(grant.id)} className="flex items-center justify-between rounded-lg bg-neutral-950 p-3 text-xs"><span><code>{text(grant.id)}</code> · expires {text(grant.expiresAt)}</span><button type="button" onClick={() => void revokeGrant(String(grant.id)).catch((cause) => setError(String(cause)))} className="text-red-300">Revoke</button></li>)}</ul>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-lg font-medium">Diagnostic Trace</h2>
          <form onSubmit={(event) => void lookupTrace(event).catch((cause) => setError(String(cause)))} className="mt-4 flex flex-wrap gap-2">
            <input name="operatorTraceRef" aria-label="Operator Trace Reference" required placeholder="otr_…" className="min-w-64 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
            <select name="operatorGrantId" aria-label="Trace Operator Grant ID" required value={selectedTraceGrantId} onChange={(event) => setSelectedTraceGrantId(event.target.value)} className="min-w-64 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="" disabled>Select active grant</option>{grants.filter((grant) => Array.isArray(grant.scopes) && grant.scopes.includes("trace.read")).map((grant) => <option key={text(grant.id)} value={String(grant.id)}>{text(grant.id)}</option>)}</select>
            <button className="rounded-md border border-neutral-700 px-4 py-2 text-sm">Read sanitized trace</button>
          </form>
          {trace ? <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4"><span>Code <code>{text(trace.code)}</code></span><span>{text(trace.stage)}</span><span>{text(trace.outcome)}</span><span>{text(trace.createdAt)}</span></div> : null}
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">Create Support Bundle</h2>
            <p className="mt-1 text-xs text-neutral-500">Choose each resource explicitly. The server builds closed projections and freezes immutable bytes; no “include all” option exists.</p>
            <form onSubmit={addSelection} className="mt-4 flex flex-wrap gap-2">
              <select name="resourceKind" aria-label="Support resource kind" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm">{Object.keys(projectionByResource).map((kind) => <option key={kind}>{kind}</option>)}</select>
              <input name="resourceId" aria-label="Support resource ID" required placeholder="Exact resource ID" className="min-w-56 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
              <button className="rounded-md border border-neutral-700 px-3 py-2 text-sm">Add</button>
            </form>
            <ol className="mt-3 space-y-1 text-xs">{selections.map((selection, index) => <li key={`${selection.resourceKind}:${selection.resourceId}:${index}`} className="flex justify-between rounded bg-neutral-950 p-2"><span>{selection.resourceKind} · <code>{selection.resourceId}</code> · {selection.projectionKind}</span><button type="button" onClick={() => setSelections((current) => current.filter((_, selected) => selected !== index))} className="text-red-300">Remove</button></li>)}</ol>
            <form onSubmit={(event) => void createBundle(event).catch((cause) => setError(String(cause)))} className="mt-4 space-y-3">
              <div className="flex flex-wrap gap-2"><select name="purpose" aria-label="Support purpose" className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="incident_diagnosis">Incident diagnosis</option><option value="support_case">Support case</option></select><input name="consentExpiresAt" aria-label="Consent expiry" type="datetime-local" required defaultValue={defaultExpiry(1)} className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" /></div>
              <label className="block text-sm"><input name="consentConfirmed" type="checkbox" required /> I explicitly consent to store only these selected projections until expiry.</label>
              <button disabled={!selections.length} className="rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-40">Freeze bundle</button>
            </form>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">Read Support Bundle</h2>
            <form onSubmit={(event) => void lookupBundle(event).catch((cause) => setError(String(cause)))} className="mt-4 space-y-2"><input name="bundleId" aria-label="Bundle ID" required placeholder="osb_…" className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" /><select name="operatorGrantId" aria-label="Bundle Operator Grant ID" required value={selectedBundleGrantId} onChange={(event) => setSelectedBundleGrantId(event.target.value)} className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"><option value="" disabled>Select active grant</option>{grants.filter((grant) => Array.isArray(grant.scopes) && grant.scopes.includes("support_bundle.read")).map((grant) => <option key={text(grant.id)} value={String(grant.id)}>{text(grant.id)}</option>)}</select><button className="rounded-md border border-neutral-700 px-4 py-2 text-sm">Read bundle</button></form>
            {bundle ? <div className="mt-4 space-y-2 text-sm"><p><code>{text(bundle.id)}</code> · {text(bundle.state)} · expires {text(bundle.expiresAt)}</p><p>{records(bundle.selections).length} selected projections · {text(bundle.sizeBytes)} bytes</p><div className="flex gap-2"><button type="button" disabled={!bundlePayload} onClick={downloadBundle} className="rounded-md border border-emerald-700 px-3 py-2 text-sm disabled:opacity-40">Download verified JSON</button><button type="button" onClick={() => void revokeBundle().catch((cause) => setError(String(cause)))} className="rounded-md border border-red-800 px-3 py-2 text-sm">Revoke</button></div></div> : null}
            <ol className="mt-4 space-y-1 text-xs text-neutral-400">{bundleAudit.map((event) => <li key={text(event.id)}>{text(event.eventType)} · {text(event.actorType)} · {text(event.occurredAt)}</li>)}</ol>
          </div>
        </section>
      </div>
    </main>
  );
}
