"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowUpRight, LoaderCircle, Sparkles, X } from "lucide-react";
import { getActiveWorkspaceId } from "@/lib/studio/client";

type Suggestion = { key: string; reason: string; href: string; generatedAt: string };
type CopilotContext = {
  suggestion: Suggestion;
  brand: { profileId: string; revision: number; digest: string; acceptedAt: string } | null;
  language: { contentLanguage: "ar" | "en" | "mixed" | null; arabicVariety: "msa" | null; basis: "active_brand_profile" | "unavailable" };
  capabilities: Array<"explain_workspace_readiness" | "navigate_recommended_action">;
  evidence: Array<{ source: "brand" | "media" | "channels" | "content" | "publishing"; status: "ready" | "missing" | "attention"; count: number; observedAt: string | null; freshness: "current" | "stale" | "unknown"; href: string }>;
  generatedAt: string;
};

export function GlobalCopilot() {
  const t = useTranslations("socialCopilot");
  const dashboard = useTranslations("product.dashboard");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState<CopilotContext | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function inspect() {
    setOpen(true);
    if (context || loading) return;
    const workspaceId = getActiveWorkspaceId();
    if (!workspaceId) return;
    setLoading(true);
    try {
      const response = await fetch("/api/product-copilot/context", { headers: { "x-workspace-id": workspaceId }, cache: "no-store" });
      const result = await response.json() as { success?: boolean } & Partial<CopilotContext>;
      if (response.ok && result.success && result.suggestion && result.language && result.capabilities && result.evidence && result.generatedAt) setContext(result as CopilotContext);
    } finally {
      setLoading(false);
    }
  }

  function dismiss() {
    if (context) sessionStorage.setItem(`tasmeemai-copilot:${getActiveWorkspaceId()}:${context.suggestion.key}`, "dismissed");
    setDismissed(true);
  }

  const hidden = context && (dismissed || sessionStorageValue(`tasmeemai-copilot:${getActiveWorkspaceId()}:${context.suggestion.key}`) === "dismissed");
  return <>
    <button type="button" onClick={inspect} aria-expanded={open} aria-controls="global-copilot-panel" className="fixed bottom-5 end-5 z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-stone-950 px-5 font-semibold text-white shadow-xl outline-none hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-amber-400"><Sparkles className="size-4 text-amber-300" />{t("button")}</button>
    {open && <aside id="global-copilot-panel" className="fixed bottom-20 end-5 z-40 w-[min(24rem,calc(100vw-2.5rem))] rounded-3xl border bg-card p-5 shadow-2xl" aria-labelledby="global-copilot-title">
      <div className="flex items-start gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800"><Sparkles className="size-5" /></div><div className="min-w-0 flex-1"><h2 id="global-copilot-title" className="font-semibold">{t("panelTitle")}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("panelHelp")}</p></div><button type="button" onClick={() => setOpen(false)} aria-label={t("close")} className="rounded-lg p-2 hover:bg-muted"><X className="size-4" /></button></div>
      <div className="mt-5">
        {loading ? <div className="flex min-h-32 items-center justify-center"><LoaderCircle className="size-5 animate-spin" /></div> : hidden ? <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">{t("dismissed")}</div> : context ? <article className="rounded-2xl bg-stone-950 p-5 text-white"><p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-300">{t("nextAction")}</p><h3 className="mt-2 text-lg font-semibold">{dashboard(`actions.${context.suggestion.key}` as never)}</h3><p className="mt-2 text-sm leading-6 text-stone-300">{dashboard(`reasons.${context.suggestion.reason}` as never)}</p>
          <dl className="mt-4 space-y-2 border-t border-stone-700 pt-4 text-xs text-stone-300">
            <div><dt className="font-semibold text-stone-100">{t("brandContext")}</dt><dd>{context.brand ? t("brandPin", { profileId: context.brand.profileId, revision: context.brand.revision }) : t("brandUnavailable")}</dd></div>
            <div><dt className="font-semibold text-stone-100">{t("languageContext")}</dt><dd>{context.language.contentLanguage ? t("languagePin", { language: t(`languages.${context.language.contentLanguage}`), variety: context.language.arabicVariety ? t(`varieties.${context.language.arabicVariety}`) : t("varieties.none") }) : t("languageUnavailable")}</dd></div>
            <div><dt className="font-semibold text-stone-100">{t("capabilitiesTitle")}</dt><dd>{context.capabilities.map((capability) => t(`capabilities.${capability}`)).join(" · ")}</dd></div>
          </dl>
          <div className="mt-4"><h4 className="text-xs font-semibold text-stone-100">{t("evidenceTitle")}</h4><ul className="mt-2 grid grid-cols-2 gap-2">{context.evidence.map((item) => <li key={item.source}><Link href={item.href} className="block rounded-lg border border-stone-700 p-2 text-xs text-stone-300 hover:border-amber-300"><span className="block font-semibold text-white">{t(`sources.${item.source}`)}</span>{t(`freshness.${item.freshness}`)} · {item.count}</Link></li>)}</ul></div>
          <p className="mt-3 text-[11px] text-stone-400">{t("generatedAt", { value: new Date(context.generatedAt).toLocaleString() })}</p>
          <div className="mt-4 flex items-center justify-between gap-3"><button type="button" onClick={dismiss} className="text-xs text-stone-400 hover:text-white">{t("dismiss")}</button><Link href={context.suggestion.href} className="inline-flex items-center gap-2 text-sm font-semibold text-amber-300">{t("openAction")}<ArrowUpRight className="size-4" /></Link></div></article> : <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">{t("contextUnavailable")}</div>}
      </div>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">{t("authorityBoundary")}</p>
    </aside>}
  </>;
}

function sessionStorageValue(key: string) {
  return typeof window === "undefined" ? null : window.sessionStorage.getItem(key);
}
