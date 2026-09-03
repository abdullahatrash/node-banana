"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    startTransition(async () => {
      setError(null);
      try { setVerified(await postReview(reviewToken, { action: "verify", code, idempotencyKey: crypto.randomUUID() })); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "UNAVAILABLE"); }
    });
  }

  function decide(decision: "comment" | "accept" | "approve" | "reject", comment: string | null) {
    if (!verified) return;
    startTransition(async () => {
      setError(null);
      try {
        await postReview(reviewToken, { action: "decide", sessionId: verified.sessionId, sessionToken: verified.sessionToken, resourceId: verified.resourceId, revisionDigest: verified.revisionDigest, decision, comment, idempotencyKey: crypto.randomUUID() });
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
        <DecisionForm review={verified} pending={isPending} decide={decide} />
      )}
    </div>
  );
}

function DecisionForm({ review, pending, decide }: { review: VerifiedReview; pending: boolean; decide(decision: "comment" | "accept" | "approve" | "reject", comment: string | null): void }) {
  const t = useTranslations("governance.reviewGuest");
  const [comment, setComment] = useState("");
  const decisions = review.purpose === "approve_publishing" ? ["approve", "reject"] as const : review.purpose === "accept_content" ? ["accept", "reject"] as const : review.purpose === "reject" ? ["reject"] as const : [];
  return <section aria-labelledby="review-resource-title" className="grid gap-4"><div className="rounded-xl bg-muted/40 p-4"><h2 id="review-resource-title" className="font-medium">{t(`resource.${review.resourceKind}`)}</h2><p className="mt-2 font-mono text-xs" dir="ltr">{review.resourceId}</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground" dir="ltr">{review.revisionDigest}</p><p className="mt-2 text-xs text-muted-foreground">{t("expires", { value: new Date(review.expiresAt).toLocaleString() })}</p></div><div><Label htmlFor="review-comment">{t("comment")}</Label><textarea id="review-comment" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} dir="auto" className="mt-2 min-h-28 w-full rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div><div className="flex flex-wrap gap-2">{decisions.map((decision) => <Button key={decision} type="button" variant={decision === "reject" ? "destructive" : "default"} disabled={pending} onClick={() => decide(decision, comment || null)}>{t(`decisions.${decision}`)}</Button>)}{review.purpose === "comment" ? <Button type="button" disabled={pending || !comment.trim()} onClick={() => decide("comment", comment)}>{t("decisions.comment")}</Button> : null}</div><p className="text-xs text-muted-foreground">{t("exactScope")}</p></section>;
}
