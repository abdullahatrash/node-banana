"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
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
    if (!email.trim()) return;
    setStatus("sending");
    const callbackURL = new URL(
      `/onboarding?next=${encodeURIComponent(nextPath)}`,
      window.location.origin,
    ).toString();
    const result = await authClient.sendVerificationEmail({
      email: email.trim(),
      callbackURL,
    });
    setStatus(result.error ? "error" : "sent");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-neutral-100">
      <div className="fixed end-4 top-4 z-10">
        <LanguageSwitcher />
      </div>
      <section className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <p className="text-sm text-emerald-300">{t("eyebrow")}</p>
        <h1 className="mt-2 text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-2 text-sm text-neutral-400">{t("description")}</p>

        <label className="mt-6 block">
          <span className="text-xs text-neutral-400">{common("email")}</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </label>

        <button
          type="button"
          onClick={resend}
          disabled={!email.trim() || status === "sending"}
          className="mt-4 w-full rounded-md bg-neutral-100 py-2 text-sm font-medium text-neutral-900 disabled:opacity-60"
        >
          {status === "sending" ? t("sending") : t("resend")}
        </button>

        {status === "sent" ? (
          <p className="mt-3 text-sm text-emerald-300">{t("sent")}</p>
        ) : null}
        {status === "error" ? (
          <p className="mt-3 text-sm text-red-300">{t("failed")}</p>
        ) : null}

        <Link
          href="/sign-in"
          className="mt-6 block text-center text-sm text-neutral-400 underline underline-offset-4"
        >
          {t("back")}
        </Link>
      </section>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
