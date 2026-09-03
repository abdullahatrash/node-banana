"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertCircleIcon, CheckCircle2Icon, Loader2Icon, PlusIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getGovernanceSnapshot, executeGovernanceCommand, GovernanceApiError } from "@/lib/governance/client";
import { BUILT_IN_ROLE_CAPABILITIES } from "@/lib/governance/roles";
import type { GovernanceCommand } from "@/lib/governance/service";
import { BUILT_IN_WORKSPACE_ROLES, type BuiltInWorkspaceRole, type GovernanceResource, type GovernanceSnapshot } from "@/lib/governance/types";

export type GovernanceSettingsSection = "members" | "roles" | "approval" | "portfolios" | "audit" | "data" | "safety" | "bulk" | "portability";

const kindsBySection: Record<GovernanceSettingsSection, string[]> = {
  members: ["invitation_binding", "member_role_assignment"],
  roles: ["custom_role"],
  approval: ["approval_policy", "review_guest_grant"],
  portfolios: ["portfolio", "portfolio_assignment"],
  audit: ["audit_export"],
  data: ["data_region_policy", "retention_policy", "retention_hold", "deletion_receipt", "tombstone"],
  safety: ["safety_decision", "safety_appeal"],
  bulk: ["bulk_operation"],
  portability: ["workspace_import", "workspace_export"],
};

const stateKeys = {
  active: "states.active", pending: "states.pending", pending_verification: "states.pending_verification",
  previewed: "states.previewed", queued: "states.queued", cancelling: "states.cancelling",
  cancelled: "states.cancelled", completed: "states.completed", decided: "states.decided",
  verified: "states.verified", locked: "states.locked", revoked: "states.revoked",
  resolved: "states.resolved", succeeded: "states.succeeded", failed_known: "states.failed_known",
  outcome_unknown: "states.outcome_unknown",
} as const;

const errorKeys = {
  WORKSPACE_REQUIRED: "errors.WORKSPACE_REQUIRED",
  GOVERNANCE_FORBIDDEN: "errors.GOVERNANCE_FORBIDDEN",
  GOVERNANCE_STEP_UP_REQUIRED: "errors.GOVERNANCE_STEP_UP_REQUIRED",
  GOVERNANCE_CONFLICT: "errors.GOVERNANCE_CONFLICT",
  GOVERNANCE_UNSAFE_RETRY: "errors.GOVERNANCE_UNSAFE_RETRY",
  INVALID_INPUT: "errors.INVALID_INPUT",
  UNAVAILABLE: "errors.UNAVAILABLE",
} as const;

function inputValue(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function futureIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

async function browserDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function ResourceCard({ item, run }: { item: GovernanceResource; run(command: GovernanceCommand): void }) {
  const t = useTranslations("governance");
  const summary = Object.entries(item.body)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .slice(0, 3);
  const action = item.kind === "invitation_binding" && item.status === "pending" ? { label: "actions.revoke" as const, command: { type: "revoke_invitation" as const, invitationId: item.id } }
    : item.kind === "portfolio_assignment" && item.status === "active" ? { label: "actions.revoke" as const, command: { type: "revoke_portfolio_assignment" as const, assignmentId: item.id } }
      : item.kind === "bulk_operation" && item.status === "previewed" ? { label: "actions.start" as const, command: { type: "start_bulk" as const, operationId: item.id } }
        : item.kind === "bulk_operation" && ["queued", "running"].includes(item.status) ? { label: "actions.cancel" as const, command: { type: "cancel_bulk" as const, operationId: item.id } }
          : item.kind === "workspace_import" && item.status === "previewed" ? { label: "actions.execute" as const, command: { type: "execute_import" as const, importId: item.id } }
            : null;
  return (
    <article className="rounded-xl border bg-card p-4" aria-label={`${item.kind} ${item.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium" dir="auto">{t(`kinds.${item.kind}`)}</p>
        <span className="rounded-full bg-muted px-2 py-1 text-xs">{t("version", { version: item.version })}</span>
      </div>
      <p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">{item.id}</p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        {summary.map(([key, value]) => (
          <div key={key} className="min-w-0">
            <dt className="text-xs text-muted-foreground" dir="auto">{key}</dt>
            <dd className="truncate" dir="auto">{String(value)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <CheckCircle2Icon className="size-3.5" />
        {t(stateKeys[item.status as keyof typeof stateKeys] ?? "states.active")}
      </p>
      {action ? <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => run(action.command)}>{t(action.label)}</Button> : null}
    </article>
  );
}

export function GovernanceSettingsSurface({ section }: { section: GovernanceSettingsSection }) {
  const t = useTranslations("governance");
  const [snapshot, setSnapshot] = useState<GovernanceSnapshot | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function load() {
    setErrorCode(null);
    try { setSnapshot(await getGovernanceSnapshot()); }
    catch (error) { setErrorCode(error instanceof GovernanceApiError ? error.code : "UNAVAILABLE"); }
  }

  useEffect(() => { void load(); }, []);

  const items = useMemo(() => {
    if (!snapshot) return [];
    return kindsBySection[section].flatMap((kind) => snapshot.resources[kind as keyof typeof snapshot.resources] ?? []);
  }, [section, snapshot]);

  function run(command: GovernanceCommand) {
    startTransition(async () => {
      setErrorCode(null);
      try { await executeGovernanceCommand(command); await load(); }
      catch (error) { setErrorCode(error instanceof GovernanceApiError ? error.code : "UNAVAILABLE"); }
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-primary"><ShieldCheckIcon className="size-4" />{t("eyebrow")}</p>
          <h2 className="mt-1 text-2xl font-semibold">{t(`sections.${section}.title`)}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t(`sections.${section}.description`)}</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={isPending}>
          <RefreshCwIcon className="size-4" />{t("actions.refresh")}
        </Button>
      </header>

      {errorCode ? (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircleIcon className="size-4" />{t(errorKeys[errorCode as keyof typeof errorKeys] ?? "errors.UNAVAILABLE")}
        </div>
      ) : null}

      {section === "roles" ? <RoleForm run={run} disabled={isPending} /> : null}
      {section === "members" ? <InvitationForm run={run} disabled={isPending} /> : null}
      {section === "portfolios" ? <PortfolioForm run={run} disabled={isPending} /> : null}
      {section === "approval" ? <ApprovalForm run={run} disabled={isPending} /> : null}
      {section === "bulk" ? <BulkForm run={run} disabled={isPending} workspaceId={snapshot?.workspaceId ?? ""} /> : null}
      {section === "portability" ? <ImportForm run={run} disabled={isPending} /> : null}

      {section === "roles" ? <RoleCatalog /> : null}
      {section === "audit" && snapshot ? <AuditList snapshot={snapshot} /> : null}
      {section === "data" ? <RetentionClassList /> : null}

      {!snapshot && !errorCode ? <div className="flex min-h-40 items-center justify-center"><Loader2Icon className="size-6 animate-spin" /><span className="sr-only">{t("states.loading")}</span></div> : null}
      {snapshot && items.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t(`sections.${section}.empty`)}</div> : null}
      {items.length ? <div className="grid gap-3 md:grid-cols-2">{items.map((item) => <ResourceCard key={`${item.kind}:${item.id}`} item={item} run={run} />)}</div> : null}
    </div>
  );
}

function FormShell({ title, children, onSubmit, disabled }: { title: string; children: React.ReactNode; onSubmit(event: React.FormEvent<HTMLFormElement>): void; disabled: boolean }) {
  return <form onSubmit={onSubmit} className="grid gap-4 rounded-xl border bg-muted/20 p-4"><h3 className="font-semibold">{title}</h3>{children}<Button className="w-fit" type="submit" disabled={disabled}>{disabled ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}<span>{title}</span></Button></form>;
}

function RoleForm({ run, disabled }: { run(command: GovernanceCommand): void; disabled: boolean }) {
  const t = useTranslations("governance");
  return <FormShell title={t("forms.roleTitle")} disabled={disabled} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run({ type: "create_custom_role", name: inputValue(form, "name"), description: inputValue(form, "description"), capabilities: ["governance.view", "reviews.decide_content", "audit.view"] }); event.currentTarget.reset(); }}><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="role-name">{t("fields.name")}</Label><Input id="role-name" name="name" required maxLength={80} dir="auto" /></div><div><Label htmlFor="role-description">{t("fields.description")}</Label><Input id="role-description" name="description" required maxLength={500} dir="auto" /></div></div><p className="text-xs text-muted-foreground">{t("roles.customSafety")}</p></FormShell>;
}

function InvitationForm({ run, disabled }: { run(command: GovernanceCommand): void; disabled: boolean }) {
  const t = useTranslations("governance");
  const [role, setRole] = useState<BuiltInWorkspaceRole>("creator");
  return <FormShell title={t("forms.invitationTitle")} disabled={disabled} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run({ type: "create_invitation", email: inputValue(form, "email"), binding: { kind: "built_in", role }, expiresAt: futureIso(7) }); event.currentTarget.reset(); }}><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="invite-email">{t("fields.email")}</Label><Input id="invite-email" name="email" type="email" required dir="ltr" /></div><div><Label htmlFor="invite-role">{t("fields.role")}</Label><Select value={role} onValueChange={(value) => setRole(value as BuiltInWorkspaceRole)}><SelectTrigger id="invite-role"><SelectValue /></SelectTrigger><SelectContent>{BUILT_IN_WORKSPACE_ROLES.filter((item) => item !== "owner").map((item) => <SelectItem key={item} value={item}>{t(`roles.${item}`)}</SelectItem>)}</SelectContent></Select></div></div></FormShell>;
}

function PortfolioForm({ run, disabled }: { run(command: GovernanceCommand): void; disabled: boolean }) {
  const t = useTranslations("governance");
  return <FormShell title={t("forms.portfolioTitle")} disabled={disabled} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run({ type: "create_portfolio", name: inputValue(form, "name") }); event.currentTarget.reset(); }}><div><Label htmlFor="portfolio-name">{t("fields.name")}</Label><Input id="portfolio-name" name="name" required maxLength={120} dir="auto" /></div><p className="text-xs text-muted-foreground">{t("portfolios.noAuthority")}</p></FormShell>;
}

function ApprovalForm({ run, disabled }: { run(command: GovernanceCommand): void; disabled: boolean }) {
  const t = useTranslations("governance");
  return <FormShell title={t("forms.approvalTitle")} disabled={disabled} onSubmit={(event) => { event.preventDefault(); run({ type: "publish_approval_policy", policy: { purpose: "publishing_approval", mode: { kind: "single", eligibleRoleIds: ["approver"] }, separationOfDuty: true, deadlineSeconds: 3600, escalationRoleIds: ["owner"], expiresAfterSeconds: 86_400 } }); }}><p className="text-sm text-muted-foreground">{t("approval.separation")}</p></FormShell>;
}

function BulkForm({ run, disabled, workspaceId }: { run(command: GovernanceCommand): void; disabled: boolean; workspaceId: string }) {
  const t = useTranslations("governance");
  return <FormShell title={t("forms.bulkTitle")} disabled={disabled || !workspaceId} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const targets = inputValue(form, "targets").split(/\s+/).filter(Boolean); run({ type: "preview_bulk", operationCapability: inputValue(form, "capability"), concurrency: 3, quoteRef: null, items: targets.map((targetId) => ({ targetWorkspaceId: workspaceId, targetKind: "resource", targetId })) }); }}><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="bulk-capability">{t("fields.capability")}</Label><Input id="bulk-capability" name="capability" required dir="ltr" /></div><div><Label htmlFor="bulk-targets">{t("fields.targets")}</Label><Input id="bulk-targets" name="targets" required dir="ltr" /></div></div><p className="text-xs text-muted-foreground">{t("bulk.previewFirst")}</p></FormShell>;
}

function ImportForm({ run, disabled }: { run(command: GovernanceCommand): void; disabled: boolean }) {
  const t = useTranslations("governance");
  return <FormShell title={t("forms.importTitle")} disabled={disabled} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const source = inputValue(form, "source"); const sourceId = inputValue(form, "sourceId"); const kind = inputValue(form, "kind") as "custom_role" | "portfolio" | "approval_policy" | "data_region_policy" | "retention_policy"; const payload = JSON.parse(inputValue(form, "payload")) as Record<string, unknown>; void Promise.all([browserDigest(payload), browserDigest({ source, sourceId, kind, payload })]).then(([digest, sourceManifestDigest]) => run({ type: "preview_import", source, sourceManifestDigest, items: [{ kind, sourceId, digest, transferable: true, payload }] })); }}><div className="grid gap-3 sm:grid-cols-3"><div><Label htmlFor="import-source">{t("fields.source")}</Label><Input id="import-source" name="source" required dir="auto" /></div><div><Label htmlFor="import-source-id">{t("fields.sourceId")}</Label><Input id="import-source-id" name="sourceId" required dir="ltr" /></div><div><Label htmlFor="import-kind">{t("fields.kind")}</Label><select id="import-kind" name="kind" className="h-8 w-full rounded-lg border bg-background px-2 text-sm" defaultValue="portfolio">{(["custom_role", "portfolio", "approval_policy", "data_region_policy", "retention_policy"] as const).map((kind) => <option key={kind} value={kind}>{t(`kinds.${kind}`)}</option>)}</select></div></div><div><Label htmlFor="import-payload">{t("fields.payload")}</Label><textarea id="import-payload" name="payload" required dir="ltr" defaultValue={'{"name":"Imported portfolio","workspaceIds":[]}'} className="mt-2 min-h-28 w-full rounded-lg border bg-background p-3 font-mono text-xs" /></div><p className="text-xs text-muted-foreground">{t("portability.provenance")}</p></FormShell>;
}

function RoleCatalog() {
  const t = useTranslations("governance");
  return <section aria-labelledby="role-catalog-title"><h3 id="role-catalog-title" className="mb-3 font-semibold">{t("roles.catalog")}</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{BUILT_IN_WORKSPACE_ROLES.map((role) => <article key={role} className="rounded-xl border p-4"><h4 className="font-medium">{t(`roles.${role}`)}</h4><ul className="mt-2 space-y-1 text-xs text-muted-foreground">{BUILT_IN_ROLE_CAPABILITIES[role].map((capability) => <li key={capability} dir="ltr">{capability}</li>)}</ul></article>)}</div></section>;
}

function AuditList({ snapshot }: { snapshot: GovernanceSnapshot }) {
  const t = useTranslations("governance");
  return <section aria-labelledby="audit-title"><h3 id="audit-title" className="mb-3 font-semibold">{t("audit.events")}</h3><ol className="rounded-xl border">{snapshot.audit.length ? snapshot.audit.map((event) => <li key={event.id} className="grid gap-1 border-b p-3 last:border-0 sm:grid-cols-[1fr_auto]"><span dir="auto">{event.action}</span><time className="font-mono text-xs text-muted-foreground" dir="ltr">{new Date(event.occurredAt).toISOString()}</time><span className="font-mono text-xs text-muted-foreground" dir="ltr">{event.capability}</span></li>) : <li className="p-6 text-center text-sm text-muted-foreground">{t("audit.empty")}</li>}</ol></section>;
}

function RetentionClassList() {
  const t = useTranslations("governance");
  const classes = ["recoverable_draft", "workspace_media", "published_lineage", "consent_evidence", "security_evidence", "billing_tax_evidence", "provider_diagnostic", "support_attachment"] as const;
  return <section aria-labelledby="retention-title"><h3 id="retention-title" className="mb-3 font-semibold">{t("retention.classes")}</h3><div className="grid gap-2 sm:grid-cols-2">{classes.map((item) => <div key={item} className="rounded-lg border p-3 text-sm">{t(`retention.${item}`)}</div>)}</div><p className="mt-3 text-xs text-muted-foreground">{t("retention.explanation")}</p></section>;
}
