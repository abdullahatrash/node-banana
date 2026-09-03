"use client";

import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { useTranslations } from "next-intl";

const VARIETIES = ["msa", "gulf", "egyptian", "levantine", "maghrebi", "other"] as const;

export function GenerationAdmissionPanel() {
  const t = useTranslations("simpleStudio.admission");
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
  return <fieldset className="space-y-3 rounded-lg border bg-muted/20 p-3">
    <legend className="px-1 text-sm font-semibold">{t("title")}</legend>
    <p className="text-xs text-muted-foreground">{t("description")}</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs font-medium">{t("arabicVariety")}<select className="mt-1 w-full rounded-md border bg-background p-2" value={arabicVariety} onChange={(event) => setArabicVariety(event.target.value as typeof arabicVariety)}>{VARIETIES.map((value) => <option key={value} value={value}>{t(`varieties.${value}`)}</option>)}</select></label>
      <label className="text-xs font-medium">{t("rightsBasis")}<select className="mt-1 w-full rounded-md border bg-background p-2" value={rightsBasis} onChange={(event) => setRightsBasis(event.target.value as typeof rightsBasis)}><option value="owned">{t("rights.owned")}</option><option value="licensed">{t("rights.licensed")}</option><option value="public_domain">{t("rights.public_domain")}</option><option value="consented">{t("rights.consented")}</option></select></label>
      <label className="text-xs font-medium">{t("permittedRemix")}<select className="mt-1 w-full rounded-md border bg-background p-2" value={permittedRemix} onChange={(event) => setPermittedRemix(event.target.value as typeof permittedRemix)}><option value="reference_only">{t("remix.reference_only")}</option><option value="transform">{t("remix.transform")}</option><option value="derivative">{t("remix.derivative")}</option></select></label>
    </div>
    {rightsBasis !== "owned" ? <label className="block text-xs font-medium">{t("evidenceIds")}<input className="mt-1 w-full rounded-md border bg-background p-2" dir="ltr" value={rightsEvidenceIds.join(", ")} onChange={(event) => setRightsEvidenceIds(event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} aria-describedby="rights-evidence-hint" /><span id="rights-evidence-hint" className="mt-1 block font-normal text-muted-foreground">{t("evidenceHint")}</span></label> : null}
    <label className="flex items-start gap-2 text-xs"><input className="mt-0.5" type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /><span>{t("confirm")}</span></label>
  </fieldset>;
}
