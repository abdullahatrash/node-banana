"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircleIcon, CheckCircle2Icon, Loader2Icon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadGovernanceExport, executeGovernanceCommand, getGovernanceSnapshot, GovernanceApiError } from "@/lib/governance/client";
import type { GovernanceCommand } from "@/lib/governance/service";
import type { GovernanceCapability, GovernanceResource, GovernanceSnapshot } from "@/lib/governance/types";
import { GovernanceWorkflows } from "./GovernanceWorkflows";

export type GovernanceSettingsSection = "members" | "roles" | "approval" | "portfolios" | "audit" | "data" | "safety" | "bulk" | "portability";
export type GovernanceCommandRunner = <T = unknown>(command: GovernanceCommand) => Promise<T | null>;

const kindsBySection: Record<GovernanceSettingsSection, string[]> = {
  members: ["invitation_binding", "member_role_assignment", "membership_projection", "workspace_closure"], roles: ["custom_role"],
  approval: ["approval_policy", "approval_request", "review_guest_grant"], portfolios: ["portfolio", "portfolio_assignment"],
  audit: ["audit_export"], data: ["data_region_policy", "retention_policy", "retention_hold", "deletion_receipt", "tombstone"],
  safety: ["safety_decision", "safety_appeal"], bulk: ["bulk_operation"], portability: ["workspace_import", "workspace_export"],
};

const errorKeys: Record<string, string> = {
  WORKSPACE_REQUIRED: "errors.WORKSPACE_REQUIRED", GOVERNANCE_FORBIDDEN: "errors.GOVERNANCE_FORBIDDEN",
  GOVERNANCE_STEP_UP_REQUIRED: "errors.GOVERNANCE_STEP_UP_REQUIRED", GOVERNANCE_CONFLICT: "errors.GOVERNANCE_CONFLICT",
  GOVERNANCE_UNSAFE_RETRY: "errors.GOVERNANCE_UNSAFE_RETRY", INVALID_INPUT: "errors.INVALID_INPUT", UNAVAILABLE: "errors.UNAVAILABLE",
};

function displayValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "✓" : "—";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string" || typeof item === "number").join(", ");
  return "";
}

function ResourceCard({ item, run, can }: { item: GovernanceResource; run: GovernanceCommandRunner; can(capability: GovernanceCapability): boolean }) {
  const t = useTranslations("governance");
  const [downloadBusy, setDownloadBusy] = useState(false);
  const summary = Object.entries(item.body).flatMap(([key, value]) => {
    const rendered = displayValue(value);
    return rendered ? [[key, rendered] as const] : [];
  }).slice(0, 6);
  const collections = ["rules", "outcomes", "items", "routes"].flatMap((key) => {
    const collection = item.body[key];
    return Array.isArray(collection) && collection.some((entry) => entry && typeof entry === "object") ? [[key, collection] as const] : [];
  });
  return (
    <article className="rounded-xl border bg-card p-4" aria-label={`${item.kind} ${item.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium" dir="auto">{t(`kinds.${item.kind}`)}</p>
        <span className="rounded-full bg-muted px-2 py-1 text-xs">{t("version", { version: item.version })}</span>
      </div>
      <p className="mt-1 break-all font-mono text-xs text-muted-foreground" dir="ltr">{item.id}</p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {summary.map(([key, value]) => <div key={key} className="min-w-0 rounded-lg bg-muted/40 p-2"><dt className="text-xs text-muted-foreground" dir="auto">{t.has(`resourceFields.${key}` as never) ? t(`resourceFields.${key}` as never) : t("resourceFields.other")}</dt><dd className="break-words" dir="auto">{value}</dd></div>)}
      </dl>
      {collections.map(([key, collection]) => <details key={key} className="mt-3 rounded-lg border"><summary className="cursor-pointer p-2 text-sm font-medium">{t(`recordCollections.${key}` as never)}</summary><div className="grid gap-2 border-t p-2">{collection.map((entry, index) => <dl key={index} className="grid gap-1 rounded bg-muted/40 p-2 text-xs sm:grid-cols-2">{Object.entries(entry as Record<string, unknown>).flatMap(([entryKey, entryValue]) => { const rendered = displayValue(entryValue); return rendered ? [<div key={entryKey}><dt className="text-muted-foreground" dir="auto">{t.has(`resourceFields.${entryKey}` as never) ? t(`resourceFields.${entryKey}` as never) : t("resourceFields.other")}</dt><dd className="break-words" dir="auto">{rendered}</dd></div>] : []; })}</dl>)}</div></details>)}
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2Icon className="size-3.5" />{t.has(`states.${item.status}` as never) ? t(`states.${item.status}` as never) : t("states.unknown")}</p>
      {item.kind === "portfolio_assignment" && item.status === "active" && can("portfolios.manage") ? <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => void run({ type: "revoke_portfolio_assignment", assignmentId: item.id })}>{t("actions.revoke")}</Button> : null}
      {["audit_export", "workspace_export"].includes(item.kind) && item.status === "succeeded" && can(item.kind === "audit_export" ? "audit.export" : "exports.manage") ? <Button type="button" size="sm" variant="outline" className="mt-3" disabled={downloadBusy} onClick={() => { setDownloadBusy(true); void downloadGovernanceExport(item.id).finally(() => setDownloadBusy(false)); }}>{downloadBusy ? <Loader2Icon className="size-4 animate-spin" /> : null}{t("actions.downloadExport")}</Button> : null}
    </article>
  );
}

export function GovernanceSettingsSurface({ section }: { section: GovernanceSettingsSection }) {
  const t = useTranslations("governance");
  const [snapshot, setSnapshot] = useState<GovernanceSnapshot | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setErrorCode(null);
    try { setSnapshot(await getGovernanceSnapshot()); } catch (error) { setErrorCode(error instanceof GovernanceApiError ? error.code : "UNAVAILABLE"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const items = useMemo(() => snapshot ? kindsBySection[section].flatMap((kind) => snapshot.resources[kind as keyof typeof snapshot.resources] ?? []) : [], [section, snapshot]);
  const run = useCallback<GovernanceCommandRunner>(async <T,>(command: GovernanceCommand) => {
    setBusy(true); setErrorCode(null);
    try { const result = await executeGovernanceCommand<T>(command); await load(); return result; }
    catch (error) { setErrorCode(error instanceof GovernanceApiError ? error.code : "UNAVAILABLE"); return null; }
    finally { setBusy(false); }
  }, [load]);
  const can = useCallback((capability: GovernanceCapability) => Boolean(snapshot?.actorCapabilities.includes(capability)), [snapshot]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-medium text-primary"><ShieldCheckIcon className="size-4" />{t("eyebrow")}</p><h2 className="mt-1 text-2xl font-semibold">{t(`sections.${section}.title`)}</h2><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t(`sections.${section}.description`)}</p></div><Button variant="outline" onClick={() => void load()} disabled={busy}><RefreshCwIcon className={busy ? "size-4 animate-spin" : "size-4"} />{t("actions.refresh")}</Button></header>
      {errorCode ? <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircleIcon className="size-4" />{t((errorKeys[errorCode] ?? "errors.UNAVAILABLE") as never)}</div> : null}
      {snapshot ? <GovernanceWorkflows section={section} snapshot={snapshot} run={run} can={can} busy={busy} /> : null}
      {!snapshot && !errorCode ? <div className="flex min-h-40 items-center justify-center"><Loader2Icon className="size-6 animate-spin" /><span className="sr-only">{t("states.loading")}</span></div> : null}
      {snapshot && items.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t(`sections.${section}.empty`)}</div> : null}
      {items.length ? <section aria-label={t("resourcesTitle")} className="grid gap-3 md:grid-cols-2">{items.map((item) => <ResourceCard key={`${item.kind}:${item.id}`} item={item} run={run} can={can} />)}</section> : null}
    </div>
  );
}
