"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { getDirection } from "@/i18n/config";

type SocialProvider = "google" | "github";
type LinkedAccount = { id: string; providerId: string; accountId: string; createdAt: Date | string };
type ActiveSession = { id: string; token: string; createdAt: Date | string; expiresAt: Date | string; ipAddress?: string | null; userAgent?: string | null };
type IdentityErasurePreflight = {
  schema: "identity-erasure-preflight/v1";
  canErase: boolean;
  hasCredential: boolean;
  requiresFreshSession: boolean;
  membershipCount: number;
  ownedWorkspaces: Array<{ id: string; name: string; lifecycle: "active" | "closed" }>;
  blockers: Array<{ code: "ACTIVE_OWNED_WORKSPACE"; workspaceId: string; workspaceName: string }>;
};

function errorMessage(error: { message?: string } | null | undefined): string {
  return error?.message || "REQUEST_FAILED";
}

export function AccountSettings({
  initialUser,
  currentSessionId,
  enabledSocialProviders,
}: {
  initialUser: { name: string; email: string; emailVerified: boolean };
  currentSessionId: string;
  enabledSocialProviders: SocialProvider[];
}) {
  const t = useTranslations("product.accountSettings") as (key: string, values?: Record<string, string | number>) => string;
  const locale = useLocale() as "ar" | "en";
  const router = useRouter();
  const [tab, setTab] = useState<"profile" | "security">("profile");
  const [name, setName] = useState(initialUser.name);
  const [newEmail, setNewEmail] = useState("");
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [erasure, setErasure] = useState<IdentityErasurePreflight | null>(null);
  const [erasureLoading, setErasureLoading] = useState(true);
  const [erasureError, setErasureError] = useState("");
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  const loadSecurity = useCallback(async () => {
    const [accountResult, sessionResult] = await Promise.all([
      authClient.listAccounts(),
      authClient.listSessions(),
    ]);
    if (accountResult.error) throw new Error(errorMessage(accountResult.error));
    if (sessionResult.error) throw new Error(errorMessage(sessionResult.error));
    setAccounts((accountResult.data ?? []) as LinkedAccount[]);
    setSessions((sessionResult.data ?? []) as ActiveSession[]);
  }, []);

  const loadErasure = useCallback(async () => {
    const response = await fetch("/api/account/erasure", { cache: "no-store" });
    const body = await response.json() as {
      success?: boolean;
      code?: string;
      preflight?: IdentityErasurePreflight;
    };
    if (!response.ok || !body.preflight) throw new Error(body.code ?? "IDENTITY_ERASURE_UNAVAILABLE");
    setErasure(body.preflight);
  }, []);

  useEffect(() => {
    void loadSecurity()
      .catch((cause) => setError(cause instanceof Error ? cause.message : "REQUEST_FAILED"))
      .finally(() => setLoading(false));
    void loadErasure()
      .catch((cause) => setErasureError(cause instanceof Error ? cause.message : "IDENTITY_ERASURE_UNAVAILABLE"))
      .finally(() => setErasureLoading(false));
  }, [loadErasure, loadSecurity]);

  async function run(action: string, operation: () => Promise<{ error?: { message?: string } | null }>, successKey: string) {
    setBusy(action); setError(""); setNotice("");
    try {
      const result = await operation();
      if (result.error) throw new Error(errorMessage(result.error));
      setNotice(t(successKey));
      await loadSecurity();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "REQUEST_FAILED");
    } finally {
      setBusy("");
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("profile", () => authClient.updateUser({ name: name.trim() }), "notices.profileSaved");
    router.refresh();
  }

  async function requestEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("email", () => authClient.changeEmail({ newEmail: newEmail.trim(), callbackURL: "/settings?section=account" }), "notices.emailSent");
    setNewEmail("");
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (newPassword !== confirmPassword) { setError(t("errors.PASSWORD_MISMATCH")); return; }
    await run("password", () => authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true }), "notices.passwordChanged");
    formElement.reset();
  }

  async function signOut() {
    setBusy("signout");
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  async function eraseAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!erasure?.canErase || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy("erasure");
    setErasureError("");
    try {
      const response = await fetch("/api/account/erasure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmation: String(form.get("confirmation") ?? ""),
          acknowledgeAccessLoss: form.get("acknowledgeAccessLoss") === "on",
          acknowledgeMembershipRemoval: form.get("acknowledgeMembershipRemoval") === "on",
          exportHandled: form.get("exportHandled") === "on",
          ...(erasure.hasCredential ? { password: String(form.get("password") ?? "") } : {}),
        }),
      });
      const body = await response.json() as { success?: boolean; code?: string };
      if (!response.ok || !body.success) throw new Error(body.code ?? "IDENTITY_ERASURE_UNAVAILABLE");
      router.replace("/sign-in?erased=1");
      router.refresh();
    } catch (cause) {
      setErasureError(cause instanceof Error ? cause.message : "IDENTITY_ERASURE_UNAVAILABLE");
      setBusy("");
    }
  }

  function erasureErrorMessage(code: string): string {
    const known = [
      "ACTIVE_OWNED_WORKSPACE",
      "PASSWORD_REQUIRED",
      "INVALID_PASSWORD",
      "FRESH_SESSION_REQUIRED",
      "INVALID_INPUT",
      "SAME_ORIGIN_REQUIRED",
      "IDENTITY_ERASURE_UNAVAILABLE",
    ];
    return known.includes(code)
      ? t(`lifecycle.errors.${code}`)
      : t("lifecycle.errors.IDENTITY_ERASURE_UNAVAILABLE");
  }

  const hasCredential = accounts.some((account) => account.providerId === "credential");
  const linkedProviders = new Set(accounts.map((account) => account.providerId));
  const providerLabel = (providerId: string) => ["credential", "google", "github", "magic-link"].includes(providerId) ? t(`providers.${providerId}`) : providerId;

  return <div dir={getDirection(locale)} className="space-y-7 p-5 sm:p-8">
    <header><h2 className="text-2xl font-semibold">{t("title")}</h2><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t("description")}</p></header>
    <div role="tablist" aria-label={t("tabs.label")} className="inline-flex rounded-lg bg-muted p-1">
      {(["profile", "security"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className="min-h-10 rounded-md px-4 text-sm font-semibold aria-selected:bg-background aria-selected:shadow-sm">{t(`tabs.${value}`)}</button>)}
    </div>
    {error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{t("errors.generic", { message: error })}</p> : null}
    {notice ? <p role="status" className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-800">{notice}</p> : null}

    {tab === "profile" ? <div role="tabpanel" className="space-y-7">
      <section className="rounded-2xl border p-5"><h3 className="font-semibold">{t("profile.title")}</h3><form className="mt-4 grid gap-4" onSubmit={(event) => void saveProfile(event)}><label className="grid gap-1.5 text-sm"><span>{t("profile.name")}</span><input required minLength={1} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} className="min-h-11 rounded-lg border bg-background px-3" /></label><label className="grid gap-1.5 text-sm"><span>{t("profile.primaryEmail")}</span><input readOnly dir="ltr" value={initialUser.email} className="min-h-11 rounded-lg border bg-muted px-3 text-start" /></label><p className="text-xs text-muted-foreground">{initialUser.emailVerified ? t("profile.verified") : t("profile.unverified")}</p><button disabled={busy !== "" || !name.trim()} className="min-h-11 justify-self-start rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">{busy === "profile" ? t("saving") : t("profile.save")}</button></form></section>
      <section className="rounded-2xl border p-5"><h3 className="font-semibold">{t("email.title")}</h3><p className="mt-2 text-sm text-muted-foreground">{t("email.description")}</p><form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => void requestEmailChange(event)}><label className="grid min-w-0 flex-1 gap-1.5 text-sm"><span>{t("email.new")}</span><input required type="email" dir="ltr" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} className="min-h-11 rounded-lg border bg-background px-3 text-start" /></label><button disabled={busy !== ""} className="min-h-11 rounded-lg border px-4 text-sm font-semibold">{busy === "email" ? t("saving") : t("email.action")}</button></form></section>
      <section className="rounded-2xl border p-5"><h3 className="font-semibold">{t("accounts.title")}</h3><p className="mt-2 text-sm text-muted-foreground">{t("accounts.description")}</p>{loading ? <LoaderCircle className="mt-4 size-5 animate-spin" aria-label={t("loading")} /> : <div className="mt-4 grid gap-2">{accounts.map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="text-sm font-semibold">{providerLabel(account.providerId)}</p><p className="text-xs text-muted-foreground">{t("accounts.linked", { date: dateTime.format(new Date(account.createdAt)) })}</p></div>{accounts.length > 1 ? <button disabled={busy !== ""} onClick={() => void run(`unlink:${account.id}`, () => authClient.unlinkAccount({ providerId: account.providerId, accountId: account.accountId }), "notices.accountUnlinked")} className="min-h-10 rounded-lg border px-3 text-sm">{t("accounts.unlink")}</button> : <span className="text-xs text-muted-foreground">{t("accounts.onlyMethod")}</span>}</div>)}</div>}
        <div className="mt-4 flex flex-wrap gap-2">{enabledSocialProviders.filter((provider) => !linkedProviders.has(provider)).map((provider) => <button key={provider} disabled={busy !== ""} onClick={() => void authClient.linkSocial({ provider, callbackURL: "/settings?section=account" })} className="min-h-10 rounded-lg border px-3 text-sm font-semibold">{t("accounts.link", { provider: providerLabel(provider) })}</button>)}</div>
      </section>
      <section className="rounded-2xl border border-destructive/30 p-5"><h3 className="font-semibold">{t("lifecycle.title")}</h3><p className="mt-2 text-sm text-muted-foreground">{t("lifecycle.description")}</p><div className="mt-4 flex flex-wrap gap-2"><Link href="/settings?section=members" className="inline-flex min-h-10 items-center rounded-lg border px-3 text-sm font-semibold">{t("lifecycle.memberships")}</Link><Link href="/settings?section=data" className="inline-flex min-h-10 items-center rounded-lg border px-3 text-sm font-semibold">{t("lifecycle.workspaceData")}</Link></div><p className="mt-3 text-xs text-muted-foreground">{t("lifecycle.boundary")}</p>
        {erasureLoading ? <LoaderCircle className="mt-5 size-5 animate-spin" aria-label={t("lifecycle.loading")} /> : erasure ? <div className="mt-5 border-t pt-5">
          <h4 className="font-semibold">{t(erasure.canErase ? "lifecycle.readyTitle" : "lifecycle.blockedTitle")}</h4>
          <p className="mt-2 text-sm text-muted-foreground">{t(erasure.canErase ? "lifecycle.readyDescription" : "lifecycle.blockedDescription")}</p>
          {erasure.blockers.length > 0 ? <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-destructive">{erasure.blockers.map((blocker) => <li key={blocker.workspaceId} dir="auto">{t("lifecycle.blocker", { name: blocker.workspaceName })}</li>)}</ul> : null}
          {erasure.canErase ? <form className="mt-5 grid gap-4" onSubmit={(event) => void eraseAccount(event)}>
            <p className="rounded-lg bg-destructive/5 p-3 text-sm">{t("lifecycle.removalNotice", { count: erasure.membershipCount })}</p>
            <label className="flex items-start gap-2 text-sm"><input required type="checkbox" name="acknowledgeAccessLoss" className="mt-1" /><span>{t("lifecycle.acknowledgeAccessLoss")}</span></label>
            <label className="flex items-start gap-2 text-sm"><input required type="checkbox" name="acknowledgeMembershipRemoval" className="mt-1" /><span>{t("lifecycle.acknowledgeMembershipRemoval")}</span></label>
            <label className="flex items-start gap-2 text-sm"><input required type="checkbox" name="exportHandled" className="mt-1" /><span>{t("lifecycle.exportHandled")}</span></label>
            <label className="grid gap-1.5 text-sm"><span>{t("lifecycle.confirmationLabel")}</span><input required name="confirmation" dir="ltr" pattern="ERASE" autoComplete="off" className="min-h-11 rounded-lg border bg-background px-3 text-start font-mono" /><span className="text-xs text-muted-foreground">{t("lifecycle.confirmationHelp")}</span></label>
            {erasure.hasCredential ? <label className="grid gap-1.5 text-sm"><span>{t("lifecycle.password")}</span><input required type="password" name="password" minLength={1} maxLength={128} autoComplete="current-password" className="min-h-11 rounded-lg border bg-background px-3" /></label> : <p className="rounded-lg bg-amber-500/10 p-3 text-sm">{t("lifecycle.oauthFreshness")}</p>}
            <button disabled={busy !== ""} className="min-h-11 justify-self-start rounded-lg bg-destructive px-4 text-sm font-semibold text-destructive-foreground">{busy === "erasure" ? t("lifecycle.erasing") : t("lifecycle.erase")}</button>
          </form> : null}
        </div> : null}
        {erasureError ? <p role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{erasureErrorMessage(erasureError)}</p> : null}
      </section>
    </div> : <div role="tabpanel" className="space-y-7">
      <section className="rounded-2xl border p-5"><h3 className="font-semibold">{t("password.title")}</h3>{hasCredential ? <form className="mt-4 grid gap-4" onSubmit={(event) => void changePassword(event)}>{["currentPassword", "newPassword", "confirmPassword"].map((field) => <label key={field} className="grid gap-1.5 text-sm"><span>{t(`password.${field}`)}</span><input required type="password" name={field} minLength={field === "currentPassword" ? 1 : 8} maxLength={128} autoComplete={field === "currentPassword" ? "current-password" : "new-password"} className="min-h-11 rounded-lg border bg-background px-3" /></label>)}<p className="text-xs text-muted-foreground">{t("password.revokeNotice")}</p><button disabled={busy !== ""} className="min-h-11 justify-self-start rounded-lg border px-4 text-sm font-semibold">{busy === "password" ? t("saving") : t("password.action")}</button></form> : <p className="mt-3 text-sm text-muted-foreground">{t("password.oauthOnly")}</p>}</section>
      <section className="rounded-2xl border p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{t("sessions.title")}</h3><p className="mt-2 text-sm text-muted-foreground">{t("sessions.description")}</p></div>{sessions.length > 1 ? <button disabled={busy !== ""} onClick={() => void run("revokeOthers", () => authClient.revokeOtherSessions(), "notices.sessionsRevoked")} className="min-h-10 rounded-lg border px-3 text-sm font-semibold">{t("sessions.revokeOthers")}</button> : null}</div>{loading ? <LoaderCircle className="mt-4 size-5 animate-spin" aria-label={t("loading")} /> : <div className="mt-4 grid gap-2">{sessions.map((session) => { const current = session.id === currentSessionId; return <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{session.userAgent || t("sessions.unknownDevice")}</p><p className="text-xs text-muted-foreground"><bdi>{session.ipAddress || t("sessions.unknownAddress")}</bdi> · {t("sessions.expires", { date: dateTime.format(new Date(session.expiresAt)) })}</p></div>{current ? <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-800">{t("sessions.current")}</span> : <button disabled={busy !== ""} onClick={() => void run(`session:${session.id}`, () => authClient.revokeSession({ token: session.token }), "notices.sessionRevoked")} className="min-h-10 rounded-lg border px-3 text-sm">{t("sessions.revoke")}</button>}</div>; })}</div>}</section>
      <section className="rounded-2xl border p-5"><h3 className="font-semibold">{t("signOut.title")}</h3><p className="mt-2 text-sm text-muted-foreground">{t("signOut.description")}</p><button disabled={busy !== ""} onClick={() => void signOut()} className="mt-4 min-h-11 rounded-lg border px-4 text-sm font-semibold">{t("signOut.action")}</button></section>
    </div>}
  </div>;
}
