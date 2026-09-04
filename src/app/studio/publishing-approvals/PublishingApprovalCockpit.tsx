"use client";

import { useTranslations } from "next-intl";
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

function workspaceHeaders(extra?: HeadersInit): Headers {
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) throw new Error("Select a Workspace before reviewing Approvals.");
  const headers = new Headers(extra);
  headers.set("x-workspace-id", workspaceId);
  return headers;
}

async function json<T>(response: Response): Promise<ApiEnvelope<T>> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.success) {
    throw new Error(body.error || "The Approval request is unavailable.");
  }
  return body;
}

async function listApprovals(): Promise<PublishingApprovalDto[]> {
  const response = await fetch("/api/studio/publishing-approvals?limit=100", {
    headers: workspaceHeaders(),
    cache: "no-store",
  });
  const body = await json<PublishingApprovalDto[]>(response);
  return body.items ?? [];
}

async function inspectApproval(
  approvalRequestId: string,
): Promise<PublishingApprovalPresentation> {
  const response = await fetch(
    `/api/studio/publishing-approvals/${encodeURIComponent(approvalRequestId)}`,
    { headers: workspaceHeaders(), cache: "no-store" },
  );
  const body = await json<PublishingApprovalPresentation>(response);
  if (!body.presentation) throw new Error("The Approval presentation is unavailable.");
  return body.presentation;
}

async function listAuthorityGrants(): Promise<AuthorityGrantDto[]> {
  const response = await fetch("/api/studio/publishing-approval-authority", {
    headers: workspaceHeaders(),
    cache: "no-store",
  });
  const body = await json<AuthorityGrantDto[]>(response);
  return body.grants ?? [];
}

function shortDigest(value: string): string {
  return value.length > 24 ? `${value.slice(0, 17)}…${value.slice(-6)}` : value;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function badge(status: PublishingApprovalDto["status"]): string {
  if (status === "pending") return "border-amber-700 bg-amber-950/50 text-amber-200";
  if (status === "approved") return "border-emerald-700 bg-emerald-950/50 text-emerald-200";
  if (status === "denied") return "border-red-800 bg-red-950/50 text-red-200";
  return "border-neutral-700 bg-neutral-950 text-neutral-300";
}

const eligibilityLabels: Record<
  PublishingApprovalPresentation["decisionEligibility"]["blockerCodes"][number],
  string
> = {
  REQUEST_FINAL: "The request already has a final decision.",
  REQUEST_EXPIRED: "The decision window expired.",
  REVISION_SUPERSEDED: "The Plan Revision was superseded.",
  VALIDATION_STALE: "The bound validation evidence is stale.",
  AUTHORITY_MISSING:
    "Explicit current publish Approval Authority is missing for one or more Channels.",
};

function ApprovalMedia({
  requestId,
  media,
}: {
  requestId: string;
  media: PublishingApprovalPresentationTarget["media"][number];
}) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void fetch(media.previewUrl, {
      headers: workspaceHeaders(),
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Preview unavailable");
        const blob = await response.blob();
        if (blob.type !== media.mediaType) throw new Error("Preview media mismatch");
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Preview unavailable");
        }
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media.mediaType, media.previewUrl, requestId]);
  return (
    <figure className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
      {source ? (
        <Image
          src={source}
          alt={`Exact media Artifact ${media.artifactId}`}
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
          {error || "Loading exact media…"}
        </div>
      )}
      <figcaption className="mt-2 break-all font-mono text-xs text-neutral-500">
        {media.artifactId} · {media.mediaType} · {media.digest}
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
  return (
    <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium">
            {target.channel.displayName ?? "Historical LinkedIn Channel"}
          </h3>
          <p className="mt-1 text-xs text-neutral-400">
            {t("copy.linkedin")} {target.channel.authorKind} {t("copy.channel")} <code>{target.channel.id}</code>
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            {t("copy.exactTarget")} <code>{target.targetId}</code>
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
          {covered ? "Publish authority covered" : "Publish authority missing"}
        </span>
      </div>

      <section className="mt-5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          {t("copy.exactContent")}
        </h4>
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-neutral-950 p-4 font-sans text-sm text-neutral-100">
          {target.content.text}
        </pre>
        <p className="mt-2 break-all font-mono text-xs text-neutral-500">
          {target.content.artifactId} · {target.content.digest}
        </p>
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
          <dd>{t("copy.authorType")} {target.settings.type}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">{t("copy.timing")}</dt>
          <dd>
            {target.timing.kind === "now" ? "Publish now" : "Scheduled"} ·{" "}
            <time dateTime={target.timing.publishAt}>{formatDate(target.timing.publishAt)}</time>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">{t("copy.validationEvidence")}</dt>
          <dd className="font-mono" title={target.targetEvidenceDigest}>
            {shortDigest(target.targetEvidenceDigest)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">{t("copy.relevantCostContext")}</dt>
          <dd>
            {target.costContext ? (
              <>
                {target.costContext.estimatedAmount} {target.costContext.currency}
                <span className="block text-xs text-neutral-500">
                  {t("copy.nonAuthoritativeEstimateComputed")} {formatDate(target.costContext.computedAt)}
                </span>
                <span className="block break-all font-mono text-xs text-neutral-500">
                  {t("copy.pricing")} {target.costContext.pricingSnapshotIds.join(", ") || "no priced snapshot"}
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
              {t("copy.evaluated")} <time dateTime={target.validation.evaluatedAt}>{formatDate(target.validation.evaluatedAt)}</time>
              <span className="block text-xs text-neutral-500">
                {t("copy.expires")} <time dateTime={target.validation.expiresAt}>{formatDate(target.validation.expiresAt)}</time>
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">{t("copy.trustedChannelSnapshot")}</dt>
            <dd>
              <code>{target.validation.channelSnapshot.id}</code> · {target.validation.channelSnapshot.platform} {target.validation.channelSnapshot.authorKind}
              <span className="block break-all font-mono text-xs text-neutral-500">
                {t("copy.snapshot")} {target.validation.channelSnapshot.snapshotDigest}
              </span>
              <span className="block break-all font-mono text-xs text-neutral-500">
                {t("copy.capability")} {target.validation.channelSnapshot.capabilityVersion}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">{t("copy.settingsBinding")}</dt>
            <dd className="break-all font-mono">
              {target.validation.settingsDigest}
              <span className="block font-sans text-xs text-neutral-500">
                {t("copy.publishAt")} {formatDate(target.validation.publishAt)}
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
                    <code>{artifact.id}</code> · {artifact.kind} · {artifact.mediaType} · {artifact.sizeBytes} {t("copy.bytes")}
                    <span className="block break-all font-mono text-xs text-neutral-500">
                      {t("copy.content")} {artifact.digest}
                    </span>
                    <span className="block break-all font-mono text-xs text-neutral-500">
                      {t("copy.snapshot")} {artifact.snapshotDigest}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div className="md:col-span-2 xl:col-span-3">
            <dt className="text-xs text-neutral-500">{t("copy.runtimePolicyDecision")}</dt>
            <dd>
              {t("copy.outcome")} <strong>{target.validation.policy.outcome}</strong> {t("copy.blockers")} {target.validation.policy.blockerCodes.length ? target.validation.policy.blockerCodes.join(", ") : "none"}
              <span className="block break-all font-mono text-xs text-neutral-500">
                {t("copy.policy")} {target.validation.policy.identity} {t("copy.contract")} {target.validation.policy.contractDigest}
              </span>
              <span className="block break-all font-mono text-xs text-neutral-500">
                {t("copy.evidence")} {target.validation.policy.evidenceDigest}
              </span>
              <span className="block break-all font-mono text-xs text-neutral-500">
                {t("copy.state")} {target.validation.policy.stateDigest}
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
      const next = await inspectApproval(approvalRequestId);
      if (sequence === inspectionSequence.current) {
        setPresentation(next);
        setReviewed(false);
      }
    } finally {
      if (sequence === inspectionSequence.current) setBusy(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const sequence = ++inspectionSequence.current;
    setBusy(true);
    setError("");
    try {
      const [nextItems, nextGrants] = await Promise.all([
        listApprovals(),
        listAuthorityGrants(),
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
        const next = await inspectApproval(nextSelected);
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
  }, [selectedId]);

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
          headers: workspaceHeaders({
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
      await json<PublishingApprovalDto>(response);
      decisionKeys.current.delete(fingerprint);
      setNotice(
        decision === "approved"
          ? "This exact publishing action was approved. Publish authorization is still required."
          : "This exact publishing action was denied. Denial is final.",
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
        headers: workspaceHeaders({
          "content-type": "application/json",
          "idempotency-key": stableMutationKey("authority.issue", payload),
        }),
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      await json<AuthorityGrantDto>(response);
      decisionKeys.current.delete(mutationFingerprint);
      setNotice("Explicit publish Approval Authority grant recorded.");
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
          headers: workspaceHeaders({
            "idempotency-key": stableMutationKey("authority.revoke", { grantId }),
          }),
          cache: "no-store",
        },
      );
      await json<AuthorityGrantDto>(response);
      decisionKeys.current.delete(mutationFingerprint);
      setNotice("Approval Authority grant revoked.");
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
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
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

        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
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
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-neutral-300">
              {t("copy.linkedinChannelID")}
              <input
                name="channelId"
                required
                placeholder={t("copy.exactChannelID")}
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-neutral-300">
              {t("copy.expiryOptional")}
              <input
                name="expiresAt"
                type="datetime-local"
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
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-xs">
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
                  const expired =
                    Boolean(grant.expiresAt) &&
                    new Date(grant.expiresAt!).getTime() <= Date.now();
                  const state = grant.revokedAt
                    ? "revoked"
                    : expired
                      ? "expired"
                      : "active";
                  return (
                    <tr key={grant.id} className="border-t border-neutral-800">
                      <td className="px-2 py-3"><code>{grant.userId}</code><span className="block text-neutral-500">{grant.subjectRoleAtIssue}</span></td>
                      <td className="px-2 py-3"><code>{grant.channelId}</code></td>
                      <td className="px-2 py-3">{t("copy.linkedin2")} {grant.action}</td>
                      <td className="px-2 py-3">{formatDate(grant.issuedAt)}<span className="block text-neutral-500">{grant.expiresAt ? formatDate(grant.expiresAt) : "no expiry"}</span></td>
                      <td className="px-2 py-3">{state}</td>
                      <td className="px-2 py-3 text-right">
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
            {!grants.length ? (
              <p className="py-4 text-sm text-neutral-500">{t("copy.noExplicitApprovalAuthorityGrants")}</p>
            ) : null}
          </div>
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
                      className="w-full rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-left hover:border-neutral-600 disabled:opacity-60 aria-[current=true]:border-amber-600"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{t("copy.planRevision")} {item.planRevision}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${badge(item.status)}`}>
                          {item.status}
                        </span>
                      </span>
                      <span className="mt-2 block text-xs text-neutral-500">
                        {item.targetIds.length} {t("copy.target")}{item.targetIds.length === 1 ? "" : "s"} {t("copy.expires2")} {formatDate(item.decisionPolicy.expiresAt)}
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
                        {t("copy.plan")} <code>{approval.planId}</code> {t("copy.revision")} {approval.planRevision} · {approval.targetIds.length} {t("copy.exactTarget2")}{approval.targetIds.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs ${badge(approval.status)}`}>
                      {approval.status}
                    </span>
                  </div>
                  <dl className="mt-5 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-3">
                    <div><dt className="text-xs text-neutral-500">{t("copy.revisionDigest")}</dt><dd className="break-all font-mono">{approval.planRevisionDigest}</dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.requestedByAgentPrincipal")}</dt><dd><code>{approval.requestingPrincipalId}</code></dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.decisionExpires")}</dt><dd><time dateTime={approval.decisionPolicy.expiresAt}>{formatDate(approval.decisionPolicy.expiresAt)}</time></dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.validationEvaluated")}</dt><dd><time dateTime={approval.validation.evaluatedAt}>{formatDate(approval.validation.evaluatedAt)}</time></dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.validationEvidence")}</dt><dd className="break-all font-mono">{approval.validation.evidenceDigest}</dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.currentStateDigest")}</dt><dd className="break-all font-mono">{approval.validation.currentStateDigest}</dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.validationContext")}</dt><dd><code>{approval.validation.contextId}</code><span className="block break-all font-mono text-xs text-neutral-500">{approval.validation.contextDigest}</span></dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.runtimePolicy")}</dt><dd>{approval.validation.runtimePolicyIdentity}<span className="block break-all font-mono text-xs text-neutral-500">{approval.validation.runtimePolicyContractDigest}</span></dd></div>
                    <div><dt className="text-xs text-neutral-500">{t("copy.requestAuthorization")}</dt><dd>{approval.requestAuthorization.capability}<span className="block break-all font-mono text-xs text-neutral-500">{approval.requestAuthorization.evidenceRef}</span></dd></div>
                  </dl>
                  <p className="mt-4 rounded-md border border-sky-900 bg-sky-950/40 p-3 text-xs text-sky-200">
                    {t("copy.thisRecordHas")} <code>{t("copy.authorizesexecutionFalse")}</code>{t("copy.aLaterPublishAttemptStillNeedsIndependent")}
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
                            .map((code) => eligibilityLabels[code])
                            .join(" ")}{" "}
                          {presentation.decisionEligibility.blockerCodes.includes(
                            "AUTHORITY_MISSING",
                          )
                            ? "Owner or admin role alone is not sufficient."
                            : "Refresh cannot make a superseded or final request decidable."}
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
                      {t("copy.thisRequestIsFinalWithStatus")} <strong>{approval.status}</strong>{t("copy.itCannotBeDecidedAgainOrRetargeted")}
                    </p>
                  )}
                </section>
              </>
            ) : (
              <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-sm text-neutral-400">
                {busy ? "Loading exact Approval evidence…" : "Select an Approval request."}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
