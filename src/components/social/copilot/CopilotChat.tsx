"use client";

import Link from "next/link";
import { ShieldAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";

/** Truthful fail-closed presentation while the admitted Social Copilot adapter is unavailable. */
export function CopilotChat() {
  const t = useTranslations("socialCopilot");
  return (
    <section className="m-auto max-w-xl rounded-xl border border-amber-500/40 bg-amber-500/10 p-6 text-center" role="status">
      <ShieldAlertIcon className="mx-auto size-8 text-amber-600" aria-hidden />
      <h2 className="mt-3 text-lg font-semibold">{t("unavailableTitle")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t("unavailableDescription")}</p>
      <Link href="/studio/model-routing" className="mt-4 inline-flex rounded-md border px-3 py-2 text-sm font-medium hover:bg-background/60">
        {t("inspectRouting")}
      </Link>
    </section>
  );
}
