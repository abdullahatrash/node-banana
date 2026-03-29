"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

function getErrorMessage(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const nextParam = searchParams.get("next");
  const nextPath =
    nextParam && nextParam.startsWith("/") ? nextParam : "/studio";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (session?.user) {
      router.replace(nextPath);
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
      });

      if (result.error) {
        setError(getErrorMessage(result.error, "Sign in failed."));
        return;
      }

      router.replace(nextPath);
    } catch (submitError) {
      setError(getErrorMessage(submitError, "Sign in failed."));
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
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="text-sm text-neutral-400 mt-1">Access your AI Studio workspace.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs text-neutral-400">Email</span>
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
            <span className="text-xs text-neutral-400">Password</span>
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
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-xs text-neutral-400">
          Need an account?{" "}
          <Link href="/sign-up" className="text-neutral-200 hover:text-white underline underline-offset-2">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
