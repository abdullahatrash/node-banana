"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordField } from "@/components/auth/PasswordField";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowRightIcon, LoaderCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";

export default function SignUpPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const t = useTranslations("auth.signUp");
  const common = useTranslations("common");
  const authShell = useTranslations("auth.shell");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (session?.user) {
      router.replace("/onboarding");
    }
  }, [router, session]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
        callbackURL: new URL("/onboarding", window.location.origin).toString(),
      });

      if (result.error) {
        setError(t("failed"));
        return;
      }

      router.replace(`/verify-email?email=${encodeURIComponent(email.trim())}`);
    } catch {
      setError(t("failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell title={t("title")} description={t("subtitle")} footer={
      <>{t("existing")}{" "}<Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">{t("signIn")}</Link></>
    }>
      <form onSubmit={handleSubmit} aria-busy={isSubmitting} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="sign-up-name" className="text-sm font-medium">{t("name")}</label>
          <Input id="sign-up-name" type="text" dir={name ? "auto" : undefined} autoComplete="name" required minLength={2} maxLength={128}
            value={name} onChange={(event) => setName(event.target.value)} className="h-11" placeholder={t("namePlaceholder")} />
        </div>
        <div className="space-y-2">
          <label htmlFor="sign-up-email" className="text-sm font-medium">{common("email")}</label>
          <Input id="sign-up-email" type="email" dir="ltr" autoComplete="email" required value={email}
            onChange={(event) => setEmail(event.target.value)} className="h-11" placeholder={common("emailPlaceholder")} />
        </div>
        <div className="space-y-2">
          <label htmlFor="sign-up-password" className="text-sm font-medium">{common("password")}</label>
          <PasswordField id="sign-up-password" autoComplete="new-password" required minLength={8} maxLength={128}
            value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby="sign-up-password-hint" />
          <p id="sign-up-password-hint" className="text-xs leading-6 text-muted-foreground">{authShell("passwordHint")}</p>
        </div>
        {error ? <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive">{error}</p> : null}
        <Button type="submit" disabled={isSubmitting || isPending} className="h-11 w-full gap-2 text-sm">
          {isSubmitting ? <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          {isSubmitting ? t("submitting") : t("submit")}
          {!isSubmitting ? <ArrowRightIcon className="size-4 rtl:rotate-180" aria-hidden="true" /> : null}
        </Button>
      </form>
    </AuthShell>
  );
}
