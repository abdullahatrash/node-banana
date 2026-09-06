"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { isSafeLocalPath } from "@/lib/auth/post-auth-destination";
import { useTranslations } from "next-intl";

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const nextParam = searchParams.get("next");
  const identityErased = searchParams.get("erased") === "1";
  const nextPath =
    nextParam && isSafeLocalPath(nextParam)
      ? nextParam
      : "/dashboard";
  const t = useTranslations("auth.signIn");
  const common = useTranslations("common");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (session?.user) {
      router.replace(`/onboarding?next=${encodeURIComponent(nextPath)}`);
    }
  }, [router, session, nextPath]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
        callbackURL: new URL(
          `/onboarding?next=${encodeURIComponent(nextPath)}`,
          window.location.origin,
        ).toString(),
      });

      if (result.error) {
        if (
          result.error.status === 403 ||
          result.error.code === "EMAIL_NOT_VERIFIED"
        ) {
          router.replace(
            `/verify-email?email=${encodeURIComponent(email.trim())}&next=${encodeURIComponent(nextPath)}`,
          );
          return;
        }
        setError(t("failed"));
        return;
      }

      router.replace(`/onboarding?next=${encodeURIComponent(nextPath)}`);
    } catch {
      setError(t("failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
      <div className="fixed top-4 end-4 z-10">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-md border border-neutral-800 bg-neutral-900 rounded-xl p-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-neutral-400 mt-1">{t("subtitle")}</p>
        {identityErased ? <p role="status" className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{t("erased")}</p> : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs text-neutral-400">{common("email")}</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
              placeholder={common("emailPlaceholder")}
            />
          </label>

          <label className="block">
            <span className="text-xs text-neutral-400">{common("password")}</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting || isPending}
            className="w-full rounded-md bg-neutral-100 text-neutral-900 py-2 text-sm font-medium hover:bg-neutral-200 disabled:opacity-60"
          >
            {isSubmitting ? t("submitting") : t("submit")}
          </button>
        </form>

        <p className="mt-4 text-xs text-neutral-400">
          {t("newAccount")}{" "}
          <Link href="/sign-up" className="text-neutral-200 hover:text-white underline underline-offset-2">
            {t("signUp")}
          </Link>
        </p>
      </div>
    </main>
  );
}
