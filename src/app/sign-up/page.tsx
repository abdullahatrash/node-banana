"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslations } from "next-intl";

export default function SignUpPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const t = useTranslations("auth.signUp");
  const common = useTranslations("common");

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
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
      <div className="fixed top-4 end-4 z-10">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-md border border-neutral-800 bg-neutral-900 rounded-xl p-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-neutral-400 mt-1">{t("subtitle")}</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs text-neutral-400">{t("name")}</span>
            <input
              type="text"
              autoComplete="name"
              required
              minLength={2}
              maxLength={128}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
              placeholder={t("namePlaceholder")}
            />
          </label>

          <label className="block">
            <span className="text-xs text-neutral-400">{common("email")}</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
              placeholder="you@example.com"
            />
          </label>

          <label className="block">
            <span className="text-xs text-neutral-400">{common("password")}</span>
            <input
              type="password"
              autoComplete="new-password"
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
          {t("existing")}{" "}
          <Link href="/sign-in" className="text-neutral-200 hover:text-white underline underline-offset-2">
            {t("signIn")}
          </Link>
        </p>
      </div>
    </main>
  );
}
