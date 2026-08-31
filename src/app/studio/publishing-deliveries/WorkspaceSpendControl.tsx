"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  invokeDeliveryOperationsApplicationCapability,
  type DeliveryOperationsResultMap,
  StudioApiError,
} from "@/lib/studio/client";

type SpendEvidence = DeliveryOperationsResultMap["spend_controls.get@2"];

function display(value: string | null): string {
  return value ?? "Unknown";
}

export function WorkspaceSpendControl({
  onAuthorizationLoss,
}: {
  onAuthorizationLoss: () => void;
}) {
  const [evidence, setEvidence] = useState<SpendEvidence | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Loading Workspace spend control evidence.");

  const load = useCallback(async (preserveActionError = false) => {
    try {
      const current = await invokeDeliveryOperationsApplicationCapability("spend_controls.get@2", {});
      setEvidence(current);
      if (!preserveActionError) setError("");
      setStatus("Canonical Workspace spend control evidence loaded.");
      return true;
    } catch (cause) {
      setEvidence(null);
      if (cause instanceof StudioApiError && (cause.status === 401 || cause.status === 403)) {
        onAuthorizationLoss();
        return false;
      }
      if (!preserveActionError) {
        setError(cause instanceof Error ? cause.message : "Workspace spend control evidence is unavailable.");
      }
      return false;
    }
  }, [onAuthorizationLoss]);

  useEffect(() => { void load(); }, [load]);

  async function verifyCoreMembership() {
    try {
      await invokeDeliveryOperationsApplicationCapability("publishing_deliveries.list@2", { limit: 1 });
      return "authorized" as const;
    } catch (cause) {
      if (cause instanceof StudioApiError && (cause.status === 401 || cause.status === 403)) {
        setEvidence(null);
        onAuthorizationLoss();
        return "authorization_lost" as const;
      }
      return "inconclusive" as const;
    }
  }

  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const reason = String(new FormData(form).get("reason") ?? "").trim();
    const suspend = !evidence?.suspended;
    setBusy(true);
    try {
      const result = await invokeDeliveryOperationsApplicationCapability(
        suspend ? "spend_controls.suspend@2" : "spend_controls.resume@2",
        { reason },
      );
      setEvidence(result);
      setError("");
      setStatus(`Emergency Spend Suspension ${result.suspended ? "enabled" : "removed"} at revision ${result.revision}.`);
      form.reset();
      await load();
    } catch (cause) {
      if (cause instanceof StudioApiError && cause.status === 401) {
        setEvidence(null);
        onAuthorizationLoss();
      } else if (cause instanceof StudioApiError && cause.status === 403) {
        const original = cause.message;
        const membership = await verifyCoreMembership();
        if (membership === "authorized") {
          setError(original);
          await load(true);
        } else if (membership === "inconclusive") {
          setError(`${original} Core membership evidence is unavailable; review canonical state before retrying.`);
          await load(true);
        }
      } else {
        const original = cause instanceof Error ? cause.message : "Spend-control action failed.";
        setError(original);
        const refreshed = await load(true);
        if (!refreshed) setError(`${original} Canonical spend-control evidence refresh is unavailable.`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Workspace Emergency Spend Suspension" className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="text-lg font-medium">Workspace Emergency Spend Suspension</h2>
      <p role="status" aria-live="polite" className="sr-only">{status}</p>
      {error ? <p role="alert" className="mt-3 rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-200">{error}</p> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className={`text-lg font-medium ${evidence?.suspended ? "text-red-200" : "text-emerald-200"}`}>{evidence ? (evidence.suspended ? "Suspended" : "Not suspended") : "Unknown"}</p>
          {evidence ? <dl className="mt-3 space-y-1 text-sm"><div><dt className="inline text-neutral-500">Revision </dt><dd className="inline">{evidence.revision}</dd></div><div><dt className="inline text-neutral-500">Reason </dt><dd className="inline">{display(evidence.reason)}</dd></div><div><dt className="inline text-neutral-500">Actor / recorded </dt><dd className="inline">{display(evidence.actorUserId)} · {display(evidence.recordedAt)}</dd></div><div><dt className="inline text-neutral-500">Policy event / authorization evidence </dt><dd className="inline"><code>{display(evidence.policyEventId)}</code> · <code>{display(evidence.authorizationEvidenceRef)}</code></dd></div></dl> : null}
          <button type="button" disabled={busy} onClick={() => void load()} className="mt-4 rounded border border-neutral-700 px-3 py-2 text-sm disabled:opacity-40">Reload spend control</button>
        </div>
        <form onSubmit={(event) => void change(event)} className="space-y-3">
          <label className="block text-sm">Workspace policy reason<textarea name="reason" required minLength={1} maxLength={500} className="mt-1 min-h-24 w-full rounded border border-neutral-700 bg-neutral-950 p-3" /></label>
          <button disabled={!evidence || busy} className="rounded bg-sky-300 px-4 py-2 font-medium text-sky-950 disabled:opacity-40">{evidence?.suspended ? "Remove Emergency Spend Suspension" : "Enable Emergency Spend Suspension"}</button>
        </form>
      </div>
    </section>
  );
}
