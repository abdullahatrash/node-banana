"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon, LoaderCircleIcon, MailIcon } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { isSafeLocalPath } from "@/lib/auth/post-auth-destination";
import { useTranslations } from "next-intl";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const t = useTranslations("auth.verifyEmail");
  const common = useTranslations("common");
  const initialEmail = searchParams.get("email") ?? "";
  const requestedPath = searchParams.get("next");
  const nextPath = isSafeLocalPath(requestedPath) ? requestedPath : "/blitz";
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  const resend = async () => {
    if (!email.trim() || status === "sending") return;
    setStatus("sending");
    const callbackURL = new URL(
      `/onboarding?next=${encodeURIComponent(nextPath)}`,
      window.location.origin,
    ).toString();
    try {
      const result = await authClient.sendVerificationEmail({
        email: email.trim(),
        callbackURL,
      });
      setStatus(result.error ? "error" : "sent");
    } catch {
      setStatus("error");
    }
  };

  return (
    <AuthShell
      title={t("title")}
      description={t("description")}
      footer={
        <Link
          href={`/sign-in?next=${encodeURIComponent(nextPath)}`}
          className="inline-flex items-center gap-2 rounded font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden="true" />
          {t("back")}
        </Link>
      }
    >
      <form onSubmit={(event) => { event.preventDefault(); void resend(); }} aria-busy={status === "sending"} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="verification-email" className="text-sm font-medium">{common("email")}</label>
          <Input
            id="verification-email"
            type="email"
            dir="ltr"
            autoComplete="email"
            required
            disabled={status === "sending"}
            value={email}
            onChange={(event) => { setEmail(event.target.value); setStatus("idle"); }}
            className="h-11"
            placeholder={common("emailPlaceholder")}
            aria-describedby={status === "error" ? "verification-error" : undefined}
          />
        </div>

        <Button
          type="submit"
          disabled={!email.trim() || status === "sending"}
          className="h-11 w-full gap-2 text-sm"
        >
          {status === "sending"
            ? <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            : <MailIcon className="size-4" aria-hidden="true" />}
          {status === "sending" ? t("sending") : t("resend")}
        </Button>

        {status === "sent" ? (
          <p role="status" className="rounded-xl border border-emerald-600/20 bg-emerald-500/10 px-4 py-3 text-sm leading-6 text-emerald-800 dark:text-emerald-200">{t("sent")}</p>
        ) : null}
        {status === "error" ? (
          <p id="verification-error" role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive">{t("failed")}</p>
        ) : null}
      </form>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
