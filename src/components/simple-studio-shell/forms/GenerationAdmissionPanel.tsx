"use client";

import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { useTranslations } from "next-intl";

const VARIETIES = ["msa", "gulf", "egyptian", "levantine", "maghrebi", "other"] as const;

export function GenerationAdmissionPanel() {
  const t = useTranslations("simpleStudio.admission");
  const automationFields = useTranslations("product.automations.fields");
  const fundingModes = useTranslations("product.automations.modes");
  const fundingMode = useSimpleStudioStore((state) => state.fundingMode);
  const setFundingMode = useSimpleStudioStore((state) => state.setFundingMode);
  const rightsBasis = useSimpleStudioStore((state) => state.rightsBasis);
  const setRightsBasis = useSimpleStudioStore((state) => state.setRightsBasis);
  const permittedRemix = useSimpleStudioStore((state) => state.permittedRemix);
  const setPermittedRemix = useSimpleStudioStore((state) => state.setPermittedRemix);
  const rightsConfirmed = useSimpleStudioStore((state) => state.rightsConfirmed);
  const setRightsConfirmed = useSimpleStudioStore((state) => state.setRightsConfirmed);
  const arabicVariety = useSimpleStudioStore((state) => state.arabicVariety);
  const setArabicVariety = useSimpleStudioStore((state) => state.setArabicVariety);
  const rightsEvidenceIds = useSimpleStudioStore((state) => state.rightsEvidenceIds);
  const setRightsEvidenceIds = useSimpleStudioStore((state) => state.setRightsEvidenceIds);
  const pendingManagedCreditQuotes = useSimpleStudioStore((state) => state.pendingManagedCreditQuotes);
  const resolveManagedCreditQuote = useSimpleStudioStore((state) => state.resolveManagedCreditQuote);
  const quote = pendingManagedCreditQuotes[0] ?? null;
  const locale = typeof document === "undefined" ? "en" : document.documentElement.lang || "en";
  return <fieldset className="space-y-3 rounded-lg border bg-muted/20 p-3">
    <legend className="px-1 text-sm font-semibold">{t("title")}</legend>
    <p className="text-xs text-muted-foreground">{t("description")}</p>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-xs font-medium">{automationFields("mode")}<select className="mt-1 w-full rounded-md border bg-background p-2" value={fundingMode} onChange={(event) => setFundingMode(event.target.value as typeof fundingMode)}><option value="byok">{fundingModes("byok")}</option><option value="managed">{fundingModes("managed")}</option></select></label>
      <label className="text-xs font-medium">{t("arabicVariety")}<select className="mt-1 w-full rounded-md border bg-background p-2" value={arabicVariety} onChange={(event) => setArabicVariety(event.target.value as typeof arabicVariety)}>{VARIETIES.map((value) => <option key={value} value={value}>{t(`varieties.${value}`)}</option>)}</select></label>
      <label className="text-xs font-medium">{t("rightsBasis")}<select className="mt-1 w-full rounded-md border bg-background p-2" value={rightsBasis} onChange={(event) => setRightsBasis(event.target.value as typeof rightsBasis)}><option value="owned">{t("rights.owned")}</option><option value="licensed">{t("rights.licensed")}</option><option value="public_domain">{t("rights.public_domain")}</option><option value="consented">{t("rights.consented")}</option></select></label>
      <label className="text-xs font-medium">{t("permittedRemix")}<select className="mt-1 w-full rounded-md border bg-background p-2" value={permittedRemix} onChange={(event) => setPermittedRemix(event.target.value as typeof permittedRemix)}><option value="reference_only">{t("remix.reference_only")}</option><option value="transform">{t("remix.transform")}</option><option value="derivative">{t("remix.derivative")}</option></select></label>
    </div>
    {rightsBasis !== "owned" ? <label className="block text-xs font-medium">{t("evidenceIds")}<input className="mt-1 w-full rounded-md border bg-background p-2" dir="ltr" value={rightsEvidenceIds.join(", ")} onChange={(event) => setRightsEvidenceIds(event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} aria-describedby="rights-evidence-hint" /><span id="rights-evidence-hint" className="mt-1 block font-normal text-muted-foreground">{t("evidenceHint")}</span></label> : null}
    <label className="flex items-start gap-2 text-xs"><input className="mt-0.5" type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /><span>{t("confirm")}</span></label>
    {quote ? <div role="dialog" aria-modal="true" aria-labelledby="managed-credit-quote-title" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border bg-background p-5 shadow-xl">
        <h2 id="managed-credit-quote-title" className="text-base font-semibold">{t("managedQuote.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("managedQuote.description")}</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t("managedQuote.creditDebit")}</dt><dd className="text-end font-medium">{new Intl.NumberFormat(locale).format(quote.totalDebitUnits)}</dd>
          <dt className="text-muted-foreground">{t("managedQuote.subtotal")}</dt><dd className="text-end font-medium">{new Intl.NumberFormat(locale, { style: "currency", currency: quote.currency }).format(quote.subtotalMinor / 100)}</dd>
          <dt className="text-muted-foreground">{t("managedQuote.tax")}</dt><dd className="text-end font-medium">{new Intl.NumberFormat(locale, { style: "currency", currency: quote.currency }).format(quote.taxMinor / 100)}</dd>
          <dt className="text-muted-foreground">{t("managedQuote.total")}</dt><dd className="text-end font-semibold">{new Intl.NumberFormat(locale, { style: "currency", currency: quote.currency }).format(quote.totalMinor / 100)}</dd>
          <dt className="text-muted-foreground">{t("managedQuote.expires")}</dt><dd className="text-end font-medium">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(quote.expiresAt))}</dd>
        </dl>
        <p className="mt-3 break-all text-[10px] text-muted-foreground">{t("managedQuote.binding", { id: quote.intentId })}</p>
        <div className="mt-5 flex justify-end gap-2"><button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => resolveManagedCreditQuote(quote.quoteId, false)}>{t("managedQuote.decline")}</button><button type="button" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => resolveManagedCreditQuote(quote.quoteId, true)}>{t("managedQuote.accept")}</button></div>
      </div>
    </div> : null}
  </fieldset>;
}
