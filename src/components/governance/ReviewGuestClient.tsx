"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2Icon, Loader2Icon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface VerifiedReview {
  sessionId: string;
  sessionToken: string;
  purpose: "inspect" | "comment" | "accept_content" | "approve_publishing" | "reject";
  resourceKind: "render_proof" | "plan_revision";
  resourceId: string;
  revisionDigest: string;
  expiresAt: string;
}

interface ReviewPresentation {
  presentationDigest: string;
  renderProof: null | { kind: "text" | "image"; text: string | null; mediaAccess: null | { url: string }; mediaType: string; sizeBytes: number };
  planRevision: null | { targets: Array<{ targetId: string; targetEvidenceDigest: string; channel: { displayName: string | null; platform: string }; content: { text: string; digest: string }; media: Array<{ artifactId: string; access: { url: string } }>; timing: { publishAt: string }; settings: Record<string, unknown> }> };
}

const errorKeys = {
  GOVERNANCE_NOT_FOUND: "errors.notFound",
  GOVERNANCE_EXPIRED: "errors.expired",
  GOVERNANCE_FORBIDDEN: "errors.forbidden",
  GOVERNANCE_CONFLICT: "errors.conflict",
  INVALID_INPUT: "errors.invalid",
  UNAVAILABLE: "errors.unavailable",
} as const;

async function postReview<T>(reviewToken: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/governance/review/${encodeURIComponent(reviewToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as { success?: boolean; code?: string; result?: T };
  if (!response.ok || !payload.success) throw new Error(payload.code ?? "UNAVAILABLE");
  return payload.result as T;
}

export function ReviewGuestClient({ reviewToken }: { reviewToken: string }) {
  const t = useTranslations("governance.reviewGuest");
  const [verified, setVerified] = useState<VerifiedReview | null>(null);
  const [completed, setCompleted] = useState(false);
  const [presentation, setPresentation] = useState<ReviewPresentation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const verifyKey = useRef(crypto.randomUUID());
  const decisionKeys = useRef(new Map<string, string>());

  function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    startTransition(async () => {
      setError(null);
      try {
        const session = await postReview<VerifiedReview>(reviewToken, { action: "verify", code, idempotencyKey: verifyKey.current });
        const inspected = await postReview<ReviewPresentation>(reviewToken, { action: "inspect", sessionId: session.sessionId, sessionToken: session.sessionToken });
        setVerified(session);
        setPresentation(inspected);
      }
      catch (failure) { setError(failure instanceof Error ? failure.message : "UNAVAILABLE"); }
    });
  }

  function decide(decision: "comment" | "accept" | "approve" | "reject", comment: string | null) {
    if (!verified) return;
    const logicalSubmission = JSON.stringify({
      sessionId: verified.sessionId,
      resourceId: verified.resourceId,
      revisionDigest: verified.revisionDigest,
      decision,
      comment,
    });
    const idempotencyKey = decisionKeys.current.get(logicalSubmission) ?? crypto.randomUUID();
    decisionKeys.current.set(logicalSubmission, idempotencyKey);
    startTransition(async () => {
      setError(null);
      try {
        await postReview(reviewToken, { action: "decide", sessionId: verified.sessionId, sessionToken: verified.sessionToken, resourceId: verified.resourceId, revisionDigest: verified.revisionDigest, decision, comment, idempotencyKey });
        setCompleted(true);
      } catch (failure) { setError(failure instanceof Error ? failure.message : "UNAVAILABLE"); }
    });
  }

  if (completed) return <div className="flex max-w-lg flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center"><CheckCircle2Icon className="size-10 text-emerald-600" /><h1 className="text-xl font-semibold">{t("completedTitle")}</h1><p className="text-sm text-muted-foreground">{t("completedDescription")}</p></div>;

  return (
    <div className="w-full max-w-2xl rounded-2xl border bg-card p-5 shadow-sm sm:p-8">
      <header className="mb-6"><p className="flex items-center gap-2 text-sm font-medium text-primary"><ShieldCheckIcon className="size-4" />{t("eyebrow")}</p><h1 className="mt-2 text-2xl font-semibold">{t("title")}</h1><p className="mt-2 text-sm text-muted-foreground">{t("description")}</p></header>
      {error ? <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{t(errorKeys[error as keyof typeof errorKeys] ?? "errors.unavailable")}</p> : null}
      {!verified ? (
        <form onSubmit={verify} className="grid gap-4"><div><Label htmlFor="review-code">{t("code")}</Label><Input id="review-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required dir="ltr" /></div><p className="text-xs text-muted-foreground">{t("codeHelp")}</p><Button type="submit" disabled={isPending}>{isPending ? <Loader2Icon className="size-4 animate-spin" /> : null}{t("verify")}</Button></form>
      ) : (
        <DecisionForm review={verified} presentation={presentation} pending={isPending} decide={decide} />
      )}
    </div>
  );
}

function DecisionForm({ review, presentation, pending, decide }: { review: VerifiedReview; presentation: ReviewPresentation | null; pending: boolean; decide(decision: "comment" | "accept" | "approve" | "reject", comment: string | null): void }) {
  const t = useTranslations("governance.reviewGuest");
  const locale = useLocale();
  const [comment, setComment] = useState("");
  const decisions = review.purpose === "approve_publishing" ? ["approve", "reject"] as const : review.purpose === "accept_content" ? ["accept", "reject"] as const : review.purpose === "reject" ? ["reject"] as const : [];
  const expiresAt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(review.expiresAt));
  return <section aria-labelledby="review-resource-title" className="grid gap-4"><div className="rounded-xl bg-muted/40 p-4"><h2 id="review-resource-title" className="font-medium">{t(`resource.${review.resourceKind}`)}</h2><p className="mt-2 font-mono text-xs" dir="ltr">{review.resourceId}</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground" dir="ltr">{review.revisionDigest}</p><p className="mt-2 text-xs text-muted-foreground">{t("expires", { value: expiresAt })}</p></div>{presentation?.renderProof ? <article className="rounded-xl border p-4" dir="auto">{presentation.renderProof.kind === "text" ? <p className="whitespace-pre-wrap text-sm">{presentation.renderProof.text}</p> : presentation.renderProof.mediaAccess ? <Image unoptimized src={presentation.renderProof.mediaAccess.url} alt="" width={960} height={960} className="h-auto max-h-[36rem] w-full rounded-lg object-contain" /> : null}</article> : null}{presentation?.planRevision?.targets.map((target) => <article key={target.targetId} className="grid gap-3 rounded-xl border p-4"><p className="text-sm font-medium">{target.channel.displayName ?? target.channel.platform}</p><p className="whitespace-pre-wrap text-sm" dir="auto">{target.content.text}</p>{target.media.map((media) => <Image key={media.artifactId} unoptimized src={media.access.url} alt="" width={960} height={960} className="h-auto max-h-[36rem] w-full rounded-lg object-contain" />)}<p className="font-mono text-xs text-muted-foreground" dir="ltr">{target.targetEvidenceDigest}</p><p className="text-xs text-muted-foreground">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(target.timing.publishAt))}</p></article>)}<div><Label htmlFor="review-comment">{t("comment")}</Label><textarea id="review-comment" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} dir="auto" className="mt-2 min-h-28 w-full rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div><div className="flex flex-wrap gap-2">{decisions.map((decision) => <Button key={decision} type="button" variant={decision === "reject" ? "destructive" : "default"} disabled={pending} onClick={() => decide(decision, comment || null)}>{t(`decisions.${decision}`)}</Button>)}{review.purpose === "comment" ? <Button type="button" disabled={pending || !comment.trim()} onClick={() => decide("comment", comment)}>{t("decisions.comment")}</Button> : null}</div><p className="break-all font-mono text-xs text-muted-foreground" dir="ltr">{presentation?.presentationDigest}</p><p className="text-xs text-muted-foreground">{t("exactScope")}</p></section>;
}
