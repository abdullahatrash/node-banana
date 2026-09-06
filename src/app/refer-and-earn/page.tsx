import Image from "next/image";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { getLocale, getTranslations } from "next-intl/server";
import { COMMERCIAL } from "@/lib/commercial/production";
import { getPublicAppUrl } from "@/lib/site-routing";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";
import { resolveWorkspaceMemberPermissions } from "@/lib/studio/authz";
import { createReferralCodeAction, requestReferralPayoutAction, saveReferralRecipientProfileAction, setReferralCodeStatusAction } from "./actions";
import { ReferralShareActions } from "./ReferralShareActions";

export const dynamic = "force-dynamic";

function rewardModeKey(value: string) {
  return value === "cash" ? "rewardModes.cash" as const : "rewardModes.generation_credit" as const;
}

function codeStateKey(value: string) {
  if (value === "paused") return "codeStates.paused" as const;
  if (value === "closed") return "codeStates.closed" as const;
  return "codeStates.active" as const;
}

function rewardStateKey(value: string) {
  const states = ["pending", "available", "payout_pending", "paid", "fraud_hold", "refunded", "clawed_back"] as const;
  const state = states.find((candidate) => candidate === value) ?? "pending";
  return `rewardStates.${state}` as const;
}

export default async function ReferAndEarnPage() {
  const [access, t, locale] = await Promise.all([
    requireOnboardingComplete("/refer-and-earn"),
    getTranslations("product.referrals"),
    getLocale(),
  ]);
  const workspaceId = access.aggregate?.session.workspaceId;
  if (!workspaceId) return <main className="p-8"><p role="alert">{t("workspaceRequired")}</p></main>;
  const [permissions, dashboard] = await Promise.all([
    resolveWorkspaceMemberPermissions({ workspaceId, userId: access.session.user.id }),
    COMMERCIAL.referralDashboard(workspaceId, access.session.user.id),
  ]);
  if (!permissions.includes("product:billing:read")) return <main className="p-8"><p role="alert">{t("forbidden")}</p></main>;

  const canManage = permissions.includes("product:billing:manage");
  const activeCode = dashboard.codes.find((code) => code.status === "active") ?? null;
  const referralUrl = activeCode ? getPublicAppUrl(`/r/${activeCode.code}`) : null;
  const qrDataUrl = referralUrl ? await QRCode.toDataURL(referralUrl, { errorCorrectionLevel: "M", margin: 1, width: 384, color: { dark: "#1c1917", light: "#ffffff" } }) : null;
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <main id="product-main-content" className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">{t("eyebrow")}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{t("title")}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">{t("description")}</p>
        </header>

        <section aria-label={t("metricsLabel")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(["clicks", "leads", "sales", "rewards"] as const).map((key) => (
            <article key={key} className="rounded-2xl border bg-card p-5 shadow-sm">
              <p className="text-sm text-muted-foreground">{t(`metrics.${key}`)}</p>
              <p className="mt-2 text-3xl font-bold tabular-nums" dir="ltr">{number.format(dashboard.metrics[key])}</p>
            </article>
          ))}
        </section>

        {activeCode && referralUrl && qrDataUrl ? (
          <section className="grid gap-5 rounded-2xl border bg-card p-5 shadow-sm lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <h2 className="text-xl font-semibold">{t("shareCardTitle")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t("shareCardDescription")}</p>
              <code className="mt-4 block overflow-x-auto rounded-xl bg-muted px-4 py-3 text-sm" dir="ltr">{referralUrl}</code>
              <div className="mt-4"><ReferralShareActions url={referralUrl} /></div>
              <p className="mt-4 text-xs text-muted-foreground">{t("firstTouchBoundary")}</p>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-2xl border bg-white p-3">
              <Image src={qrDataUrl} alt={t("qrAlt")} width={192} height={192} unoptimized className="size-48" />
              <a href={qrDataUrl} download={`tasmeemai-referral-${activeCode.code}.png`} className="text-xs font-semibold text-stone-700 underline underline-offset-4">{t("downloadQr")}</a>
            </div>
          </section>
        ) : (
          <section className="rounded-2xl border border-dashed bg-card p-6">
            <h2 className="text-xl font-semibold">{t("emptyTitle")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("emptyDescription")}</p>
          </section>
        )}

        {canManage ? (
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="text-xl font-semibold">{t("createTitle")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("createDescription")}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(["generation_credit", "cash"] as const).map((rewardMode) => (
                <form key={rewardMode} action={createReferralCodeAction} className="rounded-xl border p-4">
                  <input type="hidden" name="rewardMode" value={rewardMode} />
                  <input type="hidden" name="idempotencyKey" value={`referral-code:${randomUUID()}`} />
                  <h3 className="font-semibold">{t(`rewardModes.${rewardMode}`)}</h3>
                  <p className="mt-1 min-h-10 text-sm text-muted-foreground">{t(`rewardModeDescriptions.${rewardMode}`)}</p>
                  <button className="mt-4 min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">{t("createAction")}</button>
                </form>
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-2">
          <article className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="text-xl font-semibold">{t("linksTitle")}</h2>
            <div className="mt-4 space-y-3">
              {dashboard.codes.length === 0 ? <p className="text-sm text-muted-foreground">{t("noLinks")}</p> : dashboard.codes.map((code) => (
                <div key={code.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><code dir="ltr" className="font-semibold">{code.code}</code><p className="mt-1 text-xs text-muted-foreground">{t(rewardModeKey(code.rewardMode))} · {date.format(new Date(code.createdAt))}</p></div>
                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{t(codeStateKey(code.status))}</span>
                  </div>
                  {canManage && code.status !== "closed" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <form action={setReferralCodeStatusAction}>
                        <input type="hidden" name="codeId" value={code.id} /><input type="hidden" name="status" value={code.status === "active" ? "paused" : "active"} /><input type="hidden" name="idempotencyKey" value={`referral-status:${randomUUID()}`} />
                        <button className="min-h-9 rounded-lg border px-3 text-xs font-semibold">{code.status === "active" ? t("pause") : t("activate")}</button>
                      </form>
                      <form action={setReferralCodeStatusAction}>
                        <input type="hidden" name="codeId" value={code.id} /><input type="hidden" name="status" value="closed" /><input type="hidden" name="idempotencyKey" value={`referral-close:${randomUUID()}`} />
                        <button className="min-h-9 rounded-lg border border-destructive/40 px-3 text-xs font-semibold text-destructive">{t("close")}</button>
                      </form>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="text-xl font-semibold">{t("rewardsTitle")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("rewardsDescription")}</p>
            <div className="mt-4 space-y-3">
              {dashboard.rewards.length === 0 ? <p className="text-sm text-muted-foreground">{t("noRewards")}</p> : dashboard.rewards.map((reward) => (
                <div key={reward.id} className="flex items-center justify-between gap-4 rounded-xl border p-4">
                  <div><p className="font-medium">{t(rewardModeKey(reward.mode))}</p><p className="mt-1 text-xs text-muted-foreground">{date.format(new Date(reward.updatedAt))}</p></div>
                  <div className="text-end"><p className="font-semibold tabular-nums" dir="ltr">{reward.mode === "cash" && reward.currency && reward.cashMinor ? new Intl.NumberFormat(locale, { style: "currency", currency: reward.currency }).format(reward.cashMinor / 100) : number.format(reward.creditUnits ?? 0)}</p><p className="text-xs text-muted-foreground">{t(rewardStateKey(reward.state))}</p></div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-xl font-semibold">{t("paymentTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("paymentDescription")}</p>
          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            <form action={saveReferralRecipientProfileAction} className="space-y-4 rounded-xl border p-4">
              <div><label htmlFor="rewardPreference" className="text-sm font-semibold">{t("profile.rewardPreference")}</label><select id="rewardPreference" name="rewardPreference" defaultValue={dashboard.recipientProfile?.rewardPreference ?? "generation_credit"} className="mt-1 min-h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="generation_credit">{t("rewardModes.generation_credit")}</option><option value="cash">{t("rewardModes.cash")}</option></select></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label htmlFor="legalCountry" className="text-sm font-semibold">{t("profile.country")}</label><input id="legalCountry" name="legalCountry" dir="ltr" maxLength={2} defaultValue={dashboard.recipientProfile?.legalCountry ?? ""} placeholder={t("profile.countryPlaceholder")} className="mt-1 min-h-10 w-full rounded-lg border bg-background px-3 text-sm uppercase" /></div>
                <div><label htmlFor="payoutCurrency" className="text-sm font-semibold">{t("profile.currency")}</label><input id="payoutCurrency" name="payoutCurrency" dir="ltr" maxLength={3} defaultValue={dashboard.recipientProfile?.payoutCurrency ?? ""} placeholder={t("profile.currencyPlaceholder")} className="mt-1 min-h-10 w-full rounded-lg border bg-background px-3 text-sm uppercase" /></div>
              </div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="termsAccepted" defaultChecked={Boolean(dashboard.recipientProfile?.termsAcceptedAt)} className="mt-1" /><span>{t("profile.terms")}</span></label>
              <input type="hidden" name="idempotencyKey" value={`referral-profile:${randomUUID()}`} />
              <button disabled={!canManage} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{t("profile.save")}</button>
            </form>
            <div className="rounded-xl border p-4">
              <p className="text-sm font-semibold">{t("profile.status")}</p>
              <p className="mt-2 text-lg font-semibold">{t(`verificationStates.${dashboard.recipientProfile?.verificationState === "verified" ? "verified" : dashboard.recipientProfile?.verificationState === "pending" ? "pending" : dashboard.recipientProfile?.verificationState === "rejected" ? "rejected" : dashboard.recipientProfile?.verificationState === "suspended" ? "suspended" : "unconfigured"}`)}</p>
              <p className="mt-2 text-sm text-muted-foreground">{dashboard.recipientProfile?.verificationState === "verified" ? t("profile.verifiedDescription", { provider: dashboard.recipientProfile.payoutProvider ?? t("profile.externalProvider") }) : t("verificationDescription")}</p>
              {dashboard.recipientProfile?.verificationState === "verified" && canManage ? <form action={requestReferralPayoutAction} className="mt-4"><input type="hidden" name="idempotencyKey" value={`referral-payout:${randomUUID()}`} /><button className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">{t("profile.requestPayout")}</button></form> : null}
            </div>
          </div>
          <div className="mt-5">
            <h3 className="font-semibold">{t("payoutsTitle")}</h3>
            <div className="mt-3 space-y-2">{dashboard.payoutRequests.length === 0 ? <p className="text-sm text-muted-foreground">{t("noPayouts")}</p> : dashboard.payoutRequests.map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><p className="font-medium" dir="ltr">{new Intl.NumberFormat(locale, { style: "currency", currency: request.currency }).format(request.totalMinor / 100)}</p><p className="mt-1 text-xs text-muted-foreground">{date.format(new Date(request.submittedAt))}</p></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{t(`payoutStates.${request.state === "processing" ? "processing" : request.state === "action_required" ? "action_required" : request.state === "paid" ? "paid" : request.state === "failed_known" ? "failed_known" : request.state === "outcome_unknown" ? "outcome_unknown" : request.state === "cancelled" ? "cancelled" : "submitted"}`)}</span></div>)}</div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">{t("privacyBoundary")}</p>
        </section>
      </div>
    </main>
  );
}
