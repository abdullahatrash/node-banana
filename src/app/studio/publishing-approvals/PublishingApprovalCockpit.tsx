"use client";

import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  PublishingApprovalDecision,
  PublishingApprovalDto,
  PublishingApprovalPresentation,
  PublishingApprovalPresentationTarget,
} from "@/lib/agent-runtime/publishing-approvals/types";
import { TechnicalCode } from "@/components/ui/technical-data";
import { getActiveWorkspaceId } from "@/lib/studio/client";

interface ApiEnvelope<T> {
  success: boolean;
  error?: string;
  items?: T;
  presentation?: T;
  grants?: T;
}

interface AuthorityGrantDto {
  id: string;
  workspaceId: string;
  userId: string;
  subjectRoleAtIssue: "owner" | "admin";
  channelId: string;
  action: "publish";
  issuedByUserId: string;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedByUserId: string | null;
}

function authorityGrantState(grant: AuthorityGrantDto): "active" | "expired" | "revoked" {
  if (grant.revokedAt) return "revoked";
  if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
}

function workspaceHeaders(missingWorkspaceMessage: string, extra?: HeadersInit): Headers {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) throw new Error(missingWorkspaceMessage);
  const headers = new Headers(extra);
  headers.set("x-workspace-id", workspaceId);
  return headers;
}

async function json<T>(response: Response, fallbackMessage: string): Promise<ApiEnvelope<T>> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.success) {
    throw new Error(body.error || fallbackMessage);
  }
  return body;
}

async function listApprovals(messages: { workspace: string; unavailable: string }): Promise<PublishingApprovalDto[]> {
  const response = await fetch("/api/studio/publishing-approvals?limit=100", {
    headers: workspaceHeaders(messages.workspace),
    cache: "no-store",
  });
  const body = await json<PublishingApprovalDto[]>(response, messages.unavailable);
  return body.items ?? [];
}

async function inspectApproval(
  approvalRequestId: string,
  messages: { workspace: string; unavailable: string; presentation: string },
): Promise<PublishingApprovalPresentation> {
  const response = await fetch(
    `/api/studio/publishing-approvals/${encodeURIComponent(approvalRequestId)}`,
    { headers: workspaceHeaders(messages.workspace), cache: "no-store" },
  );
  const body = await json<PublishingApprovalPresentation>(response, messages.unavailable);
  if (!body.presentation) throw new Error(messages.presentation);
  return body.presentation;
}

async function listAuthorityGrants(messages: { workspace: string; unavailable: string }): Promise<AuthorityGrantDto[]> {
  const response = await fetch("/api/studio/publishing-approval-authority", {
    headers: workspaceHeaders(messages.workspace),
    cache: "no-store",
  });
  const body = await json<AuthorityGrantDto[]>(response, messages.unavailable);
  return body.grants ?? [];
}

function shortDigest(value: string): string {
  return value.length > 24 ? `${value.slice(0, 17)}…${value.slice(-6)}` : value;
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function badge(status: PublishingApprovalDto["status"]): string {
  if (status === "pending") return "border-amber-700 bg-amber-950/50 text-amber-200";
  if (status === "approved") return "border-emerald-700 bg-emerald-950/50 text-emerald-200";
  if (status === "denied") return "border-red-800 bg-red-950/50 text-red-200";
  return "border-neutral-700 bg-neutral-950 text-neutral-300";
}

function ApprovalMedia({
  requestId,
  media,
}: {
  requestId: string;
  media: PublishingApprovalPresentationTarget["media"][number];
}) {
  const t = useTranslations("runtimeUi.publishingApprovals");
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void fetch(media.previewUrl, {
      headers: workspaceHeaders(t("errors.workspace")),
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(t("copy.previewUnavailable"));
        const blob = await response.blob();
        if (blob.type !== media.mediaType) throw new Error(t("copy.previewMediaMismatch"));
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : t("copy.previewUnavailable"));
        }
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media.mediaType, media.previewUrl, requestId, t]);
  return (
    <figure className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
      {source ? (
        <Image
          src={source}
          alt={t("copy.exactMediaArtifact", { id: media.artifactId })}
          width={640}
          height={640}
          unoptimized
          className="max-h-80 w-full rounded-md object-contain"
        />
      ) : (
        <div
          role={error ? "alert" : "status"}
          className="flex min-h-40 items-center justify-center text-sm text-neutral-500"
        >
          {error || t("copy.loadingExactMedia")}
        </div>
      )}
      <figcaption className="mt-2">
        <TechnicalCode className="text-xs text-neutral-500">
          {media.artifactId} · {media.mediaType} · {media.digest}
        </TechnicalCode>
      </figcaption>
    </figure>
  );
}

function TargetCard({
  requestId,
  target,
  covered,
}: {
  requestId: string;
  target: PublishingApprovalPresentationTarget;
  covered: boolean;
}) {
  const t = useTranslations("runtimeUi.publishingApprovals");
  const locale = useLocale();
  return (
    <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium">
            <bdi dir="auto">{target.channel.displayName ?? t("copy.historicalLinkedinChannel")}</bdi>
          </h3>
          <p className="mt-1 text-xs text-neutral-400">
            {t("copy.linkedin")} <TechnicalCode>{target.channel.authorKind}</TechnicalCode> {t("copy.channel")} <TechnicalCode>{target.channel.id}</TechnicalCode>
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            {t("copy.exactTarget")} <TechnicalCode>{target.targetId}</TechnicalCode>
          </p>
          {target.channel.historical ? (
            <p className="mt-1 text-xs text-amber-300">
              {t("copy.liveChannelRecordUnavailableIdentityShownFrom")}
            </p>
          ) : null}
        </div>
        <span
          className={`rounded-full border px-2 py-1 text-xs ${
            covered
              ? "border-emerald-800 text-emerald-300"
              : "border-red-800 text-red-300"
          }`}
        >
          {covered ? t("copy.publishAuthorityCovered") : t("copy.publishAuthorityMissing")}
        </span>
      </div>

      <section className="mt-5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          {t("copy.exactContent")}
        </h4>
        <pre dir="auto" className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-neutral-950 p-4 font-sans text-sm text-neutral-100">
          {target.content.text}
        </pre>
        <TechnicalCode className="mt-2 text-xs text-neutral-500">
          {target.content.artifactId} · {target.content.digest}
        </TechnicalCode>
      </section>

      {target.media.length ? (
        <section className="mt-5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {t("copy.exactMedia")}
          </h4>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {target.media.map((media) => (
              <ApprovalMedia
                key={media.artifactId}
                requestId={requestId}
                media={media}
              />
            ))}
          </div>
        </section>
      ) : null}

      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-neutral-500">{t("copy.publishingSetting")}</dt>
          <dd>{t("copy.authorType")} <TechnicalCode>{target.settings.type}</TechnicalCode></dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">{t("copy.timing")}</dt>
          <dd>
            {target.timing.kind === "now" ? t("copy.publishNow") : t("copy.scheduled")} ·{" "}
            <time dateTime={target.timing.publishAt}>{formatDate(target.timing.publishAt, locale)}</time>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">{t("copy.validationEvidence")}</dt>
          <dd><TechnicalCode title={target.targetEvidenceDigest}>{shortDigest(target.targetEvidenceDigest)}</TechnicalCode></dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">{t("copy.relevantCostContext")}</dt>
          <dd>
            {target.costContext ? (
              <>
                <TechnicalCode>{target.costContext.estimatedAmount} {target.costContext.currency}</TechnicalCode>
                <span className="block text-xs text-neutral-500">
                  {t("copy.nonAuthoritativeEstimateComputed")} {formatDate(target.costContext.computedAt, locale)}
                </span>
                <span className="block text-xs text-neutral-500">
                  {t("copy.pricing")} <TechnicalCode>{target.costContext.pricingSnapshotIds.join(", ") || t("copy.noPricedSnapshot")}</TechnicalCode>
                </span>
              </>
            ) : (
              <span className="text-neutral-400">{t("copy.noBoundCostEstimateNotZero")}</span>
            )}
          </dd>
        </div>
      </dl>

      <section className="mt-5 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          {t("copy.exactSuccessfulValidationFacts")}
        </h4>
        <dl className="mt-3 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt className="text-xs text-neutral-500">{t("copy.validationWindow")}</dt>
            <dd>
              {t("copy.evaluated")} <time dateTime={target.validation.evaluatedAt}>{formatDate(target.validation.evaluatedAt, locale)}</time>
              <span className="block text-xs text-neutral-500">
                {t("copy.expires")} <time dateTime={target.validation.expiresAt}>{formatDate(target.validation.expiresAt, locale)}</time>
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">{t("copy.trustedChannelSnapshot")}</dt>
            <dd>
              <TechnicalCode>{target.validation.channelSnapshot.id} · {target.validation.channelSnapshot.platform} · {target.validation.channelSnapshot.authorKind}</TechnicalCode>
              <span className="block text-xs text-neutral-500">
                {t("copy.snapshot")} <TechnicalCode>{target.validation.channelSnapshot.snapshotDigest}</TechnicalCode>
              </span>
              <span className="block text-xs text-neutral-500">
                {t("copy.capability")} <TechnicalCode>{target.validation.channelSnapshot.capabilityVersion}</TechnicalCode>
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">{t("copy.settingsBinding")}</dt>
            <dd>
              <TechnicalCode>{target.validation.settingsDigest}</TechnicalCode>
              <span className="block font-sans text-xs text-neutral-500">
                {t("copy.publishAt")} {formatDate(target.validation.publishAt, locale)}
              </span>
            </dd>
          </div>
          <div className="md:col-span-2 xl:col-span-3">
            <dt className="text-xs text-neutral-500">{t("copy.exactArtifactSnapshotBindings")}</dt>
            <dd>
              <ul className="mt-1 space-y-2">
                {[
                  target.validation.artifacts.content,
                  ...target.validation.artifacts.media,
                ].map((artifact) => (
                  <li key={artifact.id} className="rounded border border-neutral-800 p-2">
                    <TechnicalCode>{artifact.id} · {artifact.kind} · {artifact.mediaType} · {artifact.sizeBytes}</TechnicalCode> {t("copy.bytes")}
                    <span className="block text-xs text-neutral-500">
                      {t("copy.content")} <TechnicalCode>{artifact.digest}</TechnicalCode>
                    </span>
                    <span className="block text-xs text-neutral-500">
                      {t("copy.snapshot")} <TechnicalCode>{artifact.snapshotDigest}</TechnicalCode>
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div className="md:col-span-2 xl:col-span-3">
            <dt className="text-xs text-neutral-500">{t("copy.runtimePolicyDecision")}</dt>
            <dd>
              {t("copy.outcome")} <TechnicalCode className="font-semibold">{target.validation.policy.outcome}</TechnicalCode> {t("copy.blockers")} <TechnicalCode>{target.validation.policy.blockerCodes.length ? target.validation.policy.blockerCodes.join(", ") : t("copy.none")}</TechnicalCode>
              <span className="block text-xs text-neutral-500">
                {t("copy.policy")} <TechnicalCode>{target.validation.policy.identity}</TechnicalCode> {t("copy.contract")} <TechnicalCode>{target.validation.policy.contractDigest}</TechnicalCode>
              </span>
              <span className="block text-xs text-neutral-500">
                {t("copy.evidence")} <TechnicalCode>{target.validation.policy.evidenceDigest}</TechnicalCode>
              </span>
              <span className="block text-xs text-neutral-500">
                {t("copy.state")} <TechnicalCode>{target.validation.policy.stateDigest}</TechnicalCode>
              </span>
            </dd>
          </div>
        </dl>
      </section>
    </article>
  );
}

export function PublishingApprovalCockpit() {
  const t = useTranslations("runtimeUi.publishingApprovals");
  const locale = useLocale();
  const [items, setItems] = useState<PublishingApprovalDto[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [presentation, setPresentation] =
    useState<PublishingApprovalPresentation | null>(null);
  const [grants, setGrants] = useState<AuthorityGrantDto[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const decisionKeys = useRef(new Map<string, string>());
  const inspectionSequence = useRef(0);

  const loadInspection = useCallback(async (approvalRequestId: string) => {
    const sequence = ++inspectionSequence.current;
    setBusy(true);
    setError("");
    try {
      const next = await inspectApproval(approvalRequestId, {
        workspace: t("errors.workspace"),
        unavailable: t("errors.requestUnavailable"),
        presentation: t("errors.presentationUnavailable"),
      });
      if (sequence === inspectionSequence.current) {
        setPresentation(next);
        setReviewed(false);
      }
    } finally {
      if (sequence === inspectionSequence.current) setBusy(false);
    }
  }, [t]);

  const refresh = useCallback(async () => {
    const sequence = ++inspectionSequence.current;
    setBusy(true);
    setError("");
    try {
      const [nextItems, nextGrants] = await Promise.all([
        listApprovals({ workspace: t("errors.workspace"), unavailable: t("errors.requestUnavailable") }),
        listAuthorityGrants({ workspace: t("errors.workspace"), unavailable: t("errors.authorityUnavailable") }),
      ]);
      setItems(nextItems);
      setGrants(nextGrants);
      const nextSelected =
        (selectedId && nextItems.some((item) => item.id === selectedId)
          ? selectedId
          : nextItems.find((item) => item.status === "pending")?.id) ||
        nextItems[0]?.id ||
        "";
      setSelectedId(nextSelected);
      if (nextSelected) {
        const next = await inspectApproval(nextSelected, {
          workspace: t("errors.workspace"),
          unavailable: t("errors.requestUnavailable"),
          presentation: t("errors.presentationUnavailable"),
        });
        if (sequence === inspectionSequence.current) {
          setPresentation(next);
          setReviewed(false);
        }
      } else {
        if (sequence === inspectionSequence.current) setPresentation(null);
      }
    } finally {
      if (sequence === inspectionSequence.current) setBusy(false);
    }
  }, [selectedId, t]);

  useEffect(() => {
    void refresh().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
    // Initial hydration deliberately ignores later selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(decision: PublishingApprovalDecision) {
    if (!presentation) return;
    const approval = presentation.approval;
    const fingerprint = `${approval.id}:${approval.inspectionDigest}:${decision}`;
    let idempotencyKey = decisionKeys.current.get(fingerprint);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      decisionKeys.current.set(fingerprint, idempotencyKey);
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/studio/publishing-approvals/${encodeURIComponent(approval.id)}`,
        {
          method: "POST",
          headers: workspaceHeaders(t("errors.workspace"), {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          }),
          body: JSON.stringify({
            decision,
            expectedInspectionDigest: approval.inspectionDigest,
          }),
          cache: "no-store",
        },
      );
      await json<PublishingApprovalDto>(response, t("errors.requestUnavailable"));
      decisionKeys.current.delete(fingerprint);
      setNotice(
        decision === "approved"
          ? t("copy.approvedNotice")
          : t("copy.deniedNotice"),
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function stableMutationKey(scope: string, payload: object): string {
    const fingerprint = `${scope}:${JSON.stringify(payload)}`;
    let key = decisionKeys.current.get(fingerprint);
    if (!key) {
      key = crypto.randomUUID();
      decisionKeys.current.set(fingerprint, key);
    }
    return key;
  }

  async function issueAuthority(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const rawExpiry = String(data.get("expiresAt") ?? "").trim();
    const payload = {
      userId: String(data.get("userId") ?? "").trim(),
      channelId: String(data.get("channelId") ?? "").trim(),
      expiresAt: rawExpiry ? new Date(rawExpiry).toISOString() : null,
    };
    const mutationFingerprint = `authority.issue:${JSON.stringify(payload)}`;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/studio/publishing-approval-authority", {
        method: "POST",
        headers: workspaceHeaders(t("errors.workspace"), {
          "content-type": "application/json",
          "idempotency-key": stableMutationKey("authority.issue", payload),
        }),
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      await json<AuthorityGrantDto>(response, t("errors.authorityUnavailable"));
      decisionKeys.current.delete(mutationFingerprint);
      setNotice(t("copy.grantRecorded"));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function revokeAuthority(grantId: string) {
    const mutationFingerprint = `authority.revoke:${JSON.stringify({ grantId })}`;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/studio/publishing-approval-authority/${encodeURIComponent(grantId)}`,
        {
          method: "DELETE",
          headers: workspaceHeaders(t("errors.workspace"), {
            "idempotency-key": stableMutationKey("authority.revoke", { grantId }),
          }),
          cache: "no-store",
        },
      );
      await json<AuthorityGrantDto>(response, t("errors.authorityUnavailable"));
      decisionKeys.current.delete(mutationFingerprint);
      setNotice(t("copy.grantRevoked"));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const approval = presentation?.approval ?? null;
  const allCovered =
    Boolean(presentation?.authorityCoverage.length) &&
    presentation!.authorityCoverage.every((coverage) => coverage.covered);
  const canDecide =
    approval?.status === "pending" &&
    presentation?.decisionEligibility.eligible === true &&
    allCovered &&
    reviewed &&
    !busy;

  return (
    <main className="min-h-screen w-full min-w-0 overflow-x-hidden bg-neutral-950 px-4 py-8 text-neutral-100 sm:px-6">
      <div className="mx-auto min-w-0 max-w-7xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-400">
              {t("copy.humanOnlyDecisionLane")}
            </p>
            <h1 className="mt-2 text-3xl font-semibold">{t("copy.publishingApprovalCockpit")}</h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-400">
              {t("copy.inspectTheExactImmutablePlanRevisionAnd")}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void refresh().catch((cause) => setError(String(cause)))}
            className="rounded-md border border-neutral-700 px-4 py-2 text-sm disabled:opacity-50"
          >
            {t("copy.refreshCurrentEvidence")}
          </button>
        </header>

        {error ? (
          <p role="alert" className="rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="rounded-md border border-emerald-900 bg-emerald-950/40 p-3 text-sm text-emerald-200">
            {notice}
          </p>
        ) : null}

        <section className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-lg font-medium">{t("copy.approvalAuthorityAdministration")}</h2>
          <p className="mt-1 text-sm text-neutral-400">
            {t("copy.ownersAndAdminsMayAdministerExplicitPer")}
          </p>
          <form
            onSubmit={(event) =>
              void issueAuthority(event).catch((cause) => setError(String(cause)))
            }
            className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4"
          >
            <label className="text-xs text-neutral-300">
              {t("copy.humanUserID")}
              <input
                name="userId"
                required
                placeholder={t("copy.exactOwnerAdminUserID")}
                dir="ltr"
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-neutral-300">
              {t("copy.linkedinChannelID")}
              <input
                name="channelId"
                required
                placeholder={t("copy.exactChannelID")}
                dir="ltr"
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-neutral-300">
              {t("copy.expiryOptional")}
              <input
                name="expiresAt"
                type="datetime-local"
                dir="ltr"
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              />
            </label>
            <button
              disabled={busy}
              className="self-end rounded-md border border-amber-700 px-4 py-2 text-sm text-amber-200 disabled:opacity-40"
            >
              {t("copy.issueExplicitGrant")}
            </button>
          </form>
          {grants.length ? <div dir="ltr" className="mt-4 hidden w-full min-w-0 max-w-full overflow-x-auto lg:block">
            <table dir={locale === "ar" ? "rtl" : "ltr"} className="w-full min-w-[48rem] text-start text-xs">
              <caption className="sr-only">{t("copy.publishingApprovalAuthorityGrants")}</caption>
              <thead className="text-neutral-500">
                <tr>
                  <th className="px-2 py-2 font-medium">{t("copy.human")}</th>
                  <th className="px-2 py-2 font-medium">{t("copy.channel2")}</th>
                  <th className="px-2 py-2 font-medium">{t("copy.scope")}</th>
                  <th className="px-2 py-2 font-medium">{t("copy.issuedExpires")}</th>
                  <th className="px-2 py-2 font-medium">{t("copy.state2")}</th>
                  <th className="px-2 py-2 font-medium"><span className="sr-only">{t("copy.actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => {
                  const state = authorityGrantState(grant);
                  return (
                    <tr key={grant.id} className="border-t border-neutral-800">
                      <td className="px-2 py-3"><TechnicalCode>{grant.userId}</TechnicalCode><TechnicalCode className="block text-neutral-500">{grant.subjectRoleAtIssue}</TechnicalCode></td>
                      <td className="px-2 py-3"><TechnicalCode>{grant.channelId}</TechnicalCode></td>
                      <td className="px-2 py-3">{t("copy.linkedin2")} <TechnicalCode>{grant.action}</TechnicalCode></td>
                      <td className="px-2 py-3">{formatDate(grant.issuedAt, locale)}<span className="block text-neutral-500">{grant.expiresAt ? formatDate(grant.expiresAt, locale) : t("copy.noExpiry")}</span></td>
                      <td className="px-2 py-3">{t(`status.${state}`)}</td>
                      <td className="px-2 py-3 text-end">
                        <button
                          type="button"
                          disabled={busy || state !== "active"}
                          onClick={() =>
                            void revokeAuthority(grant.id).catch((cause) =>
                              setError(String(cause)),
                            )
                          }
                          className="rounded border border-red-800 px-2 py-1 text-red-300 disabled:opacity-40"
                        >
                          {t("copy.revoke")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div> : null}
          {grants.length ? <ul aria-label={t("copy.publishingApprovalAuthorityGrants")} className="mt-4 grid min-w-0 gap-3 lg:hidden">
            {grants.map((grant) => {
              const state = authorityGrantState(grant);
              return <li key={grant.id} className="min-w-0 rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-sm">
                <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className="min-w-0"><dt className="text-xs text-neutral-500">{t("copy.human")}</dt><dd className="mt-1 min-w-0"><TechnicalCode>{grant.userId}</TechnicalCode><TechnicalCode className="block text-neutral-500">{grant.subjectRoleAtIssue}</TechnicalCode></dd></div>
                  <div className="min-w-0"><dt className="text-xs text-neutral-500">{t("copy.channel2")}</dt><dd className="mt-1 min-w-0"><TechnicalCode>{grant.channelId}</TechnicalCode></dd></div>
                  <div className="min-w-0"><dt className="text-xs text-neutral-500">{t("copy.scope")}</dt><dd className="mt-1">{t("copy.linkedin2")} <TechnicalCode>{grant.action}</TechnicalCode></dd></div>
                  <div className="min-w-0"><dt className="text-xs text-neutral-500">{t("copy.issuedExpires")}</dt><dd className="mt-1">{formatDate(grant.issuedAt, locale)}<span className="block text-neutral-500">{grant.expiresAt ? formatDate(grant.expiresAt, locale) : t("copy.noExpiry")}</span></dd></div>
                  <div className="min-w-0"><dt className="text-xs text-neutral-500">{t("copy.state2")}</dt><dd className="mt-1">{t(`status.${state}`)}</dd></div>
                </dl>
                <button
                  type="button"
                  disabled={busy || state !== "active"}
                  onClick={() => void revokeAuthority(grant.id).catch((cause) => setError(String(cause)))}
                  className="mt-4 w-full rounded border border-red-800 px-3 py-2 text-red-300 disabled:opacity-40 sm:w-auto"
                >
                  {t("copy.revoke")}
                </button>
              </li>;
            })}
          </ul> : <p className="py-4 text-sm text-neutral-500">{t("copy.noExplicitApprovalAuthorityGrants")}</p>}
        </section>

        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          <aside className="rounded-xl border border-neutral-800 bg-neutral-900 p-4" aria-label={t("copy.approvalRequests")}>
            <h2 className="font-medium">{t("copy.requests")}</h2>
            <p className="mt-1 text-xs text-neutral-500">{t("copy.pendingRequestsAppearFirst")}</p>
            <ol className="mt-4 space-y-2">
              {[...items]
                .sort((left, right) => Number(right.status === "pending") - Number(left.status === "pending"))
                .map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={busy}
                      aria-current={selectedId === item.id ? "true" : undefined}
                      onClick={() => {
                        setSelectedId(item.id);
                        void loadInspection(item.id).catch((cause) => setError(String(cause)));
                      }}
                      className="w-full rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-start hover:border-neutral-600 disabled:opacity-60 aria-[current=true]:border-amber-600"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{t("copy.planRevision")} {item.planRevision}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${badge(item.status)}`}>
                          {t(`status.${item.status}`)}
                        </span>
                      </span>
                      <span className="mt-2 block text-xs text-neutral-500">
                        {t("copy.targetCount", { count: item.targetIds.length })} {t("copy.expires2")} {formatDate(item.decisionPolicy.expiresAt, locale)}
                      </span>
                    </button>
                  </li>
                ))}
            </ol>
            {!items.length && !busy ? (
              <p className="mt-4 text-sm text-neutral-400">{t("copy.noApprovalRequestsInThisWorkspace")}</p>
            ) : null}
          </aside>

          <section aria-busy={busy} className="space-y-5">
            {approval && presentation ? (
              <>
                <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">{t("copy.exactPublishAction")}</h2>
                      <p className="mt-1 text-sm text-neutral-400">
                        {t("copy.plan")} <TechnicalCode>{approval.planId}</TechnicalCode> {t("copy.revision")} <TechnicalCode>{approval.planRevision}</TechnicalCode> · {t("copy.exactTargetCount", { count: approval.targetIds.length })}
                      </p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs ${badge(approval.status)}`}>
                      {t(`status.${approval.status}`)}
                    </span>
                  </div>
                  <dl className="mt-5 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-3">
                    <div><dt className="text-xs text-neutral-500">{t("copy.revisionDigest")}</dt><dd><TechnicalCode>{approval.planRevisionDigest}</TechnicalCode></dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.requestedByAgentPrincipal")}</dt><dd><TechnicalCode>{approval.requestingPrincipalId}</TechnicalCode></dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.decisionExpires")}</dt><dd><time dateTime={approval.decisionPolicy.expiresAt}>{formatDate(approval.decisionPolicy.expiresAt, locale)}</time></dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.validationEvaluated")}</dt><dd><time dateTime={approval.validation.evaluatedAt}>{formatDate(approval.validation.evaluatedAt, locale)}</time></dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.validationEvidence")}</dt><dd><TechnicalCode>{approval.validation.evidenceDigest}</TechnicalCode></dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.currentStateDigest")}</dt><dd><TechnicalCode>{approval.validation.currentStateDigest}</TechnicalCode></dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.validationContext")}</dt><dd><TechnicalCode>{approval.validation.contextId}</TechnicalCode><TechnicalCode className="block text-xs text-neutral-500">{approval.validation.contextDigest}</TechnicalCode></dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.runtimePolicy")}</dt><dd><TechnicalCode>{approval.validation.runtimePolicyIdentity}</TechnicalCode><TechnicalCode className="block text-xs text-neutral-500">{approval.validation.runtimePolicyContractDigest}</TechnicalCode></dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.requestAuthorization")}</dt><dd><TechnicalCode>{approval.requestAuthorization.capability}</TechnicalCode><TechnicalCode className="block text-xs text-neutral-500">{approval.requestAuthorization.evidenceRef}</TechnicalCode></dd></div>
                  </dl>
                  <p className="mt-4 rounded-md border border-sky-900 bg-sky-950/40 p-3 text-xs text-sky-200">
                    {t("copy.thisRecordHas")} <TechnicalCode>{t("copy.authorizesexecutionFalse")}</TechnicalCode>{t("copy.aLaterPublishAttemptStillNeedsIndependent")}
                  </p>
                </section>

                {presentation.targets.map((target) => (
                  <TargetCard
                    key={target.targetId}
                    requestId={approval.id}
                    target={target}
                    covered={Boolean(
                      presentation.authorityCoverage.find(
                        (coverage) => coverage.targetId === target.targetId,
                      )?.covered,
                    )}
                  />
                ))}

                <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                  <h2 className="text-lg font-medium">{t("copy.humanDecision")}</h2>
                  {approval.status === "pending" ? (
                    <>
                      {!presentation.decisionEligibility.eligible ? (
                        <p role="alert" className="mt-3 text-sm text-red-300">
                          {presentation.decisionEligibility.blockerCodes
                            .map((code) => t(`eligibility.${code}`))
                            .join(" ")}{" "}
                          {presentation.decisionEligibility.blockerCodes.includes(
                            "AUTHORITY_MISSING",
                          )
                            ? t("copy.roleAloneInsufficient")
                            : t("copy.refreshCannotRestoreEligibility")}
                        </p>
                      ) : null}
                      <label className="mt-4 flex items-start gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={reviewed}
                          onChange={(event) => setReviewed(event.target.checked)}
                          className="mt-1"
                        />
                        <span>{t("copy.iReviewedTheExactContentMediaChannels")}</span>
                      </label>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <button
                          type="button"
                          disabled={!canDecide}
                          onClick={() => void decide("approved").catch((cause) => setError(String(cause)))}
                          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-40"
                        >
                          {t("copy.approveThisExactAction")}
                        </button>
                        <button
                          type="button"
                          disabled={!canDecide}
                          onClick={() => void decide("denied").catch((cause) => setError(String(cause)))}
                          className="rounded-md border border-red-700 px-4 py-2 text-sm text-red-200 disabled:opacity-40"
                        >
                          {t("copy.denyPermanently")}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="mt-3 text-sm text-neutral-300">
                      {t("copy.thisRequestIsFinalWithStatus")} <strong>{t(`status.${approval.status}`)}</strong>{t("copy.itCannotBeDecidedAgainOrRetargeted")}
                    </p>
                  )}
                </section>
              </>
            ) : (
              <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-sm text-neutral-400">
                {busy ? t("copy.loadingExactApprovalEvidence") : t("copy.selectApprovalRequest")}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
