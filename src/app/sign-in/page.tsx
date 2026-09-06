"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordField } from "@/components/auth/PasswordField";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowRightIcon, LoaderCircleIcon } from "lucide-react";
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
    <AuthShell title={t("title")} description={t("subtitle")} footer={
      <>{t("newAccount")}{" "}<Link href="/sign-up" className="font-medium text-foreground underline-offset-4 hover:underline">{t("signUp")}</Link></>
    }>
      {identityErased ? <p role="status" className="mb-6 rounded-xl border border-emerald-600/20 bg-emerald-500/10 px-4 py-3 text-sm leading-6 text-emerald-800 dark:text-emerald-200">{t("erased")}</p> : null}
      <form onSubmit={handleSubmit} aria-busy={isSubmitting} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="sign-in-email" className="text-sm font-medium">{common("email")}</label>
          <Input id="sign-in-email" type="email" dir="ltr" autoComplete="email" required value={email}
            onChange={(event) => setEmail(event.target.value)} className="h-11" placeholder={common("emailPlaceholder")}
            aria-invalid={!!error} aria-describedby={error ? "sign-in-error" : undefined} />
        </div>
        <div className="space-y-2">
          <label htmlFor="sign-in-password" className="text-sm font-medium">{common("password")}</label>
          <PasswordField id="sign-in-password" autoComplete="current-password" required value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={!!error} aria-describedby={error ? "sign-in-error" : undefined} />
        </div>
        {error ? <p id="sign-in-error" role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive">{error}</p> : null}
        <Button type="submit" disabled={isSubmitting || isPending} className="h-11 w-full gap-2 text-sm">
          {isSubmitting ? <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          {isSubmitting ? t("submitting") : t("submit")}
          {!isSubmitting ? <ArrowRightIcon className="size-4 rtl:rotate-180" aria-hidden="true" /> : null}
        </Button>
      </form>
    </AuthShell>
  );
}
