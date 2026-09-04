"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowUpRight, LoaderCircle, Sparkles, X } from "lucide-react";
import { getActiveWorkspaceId } from "@/lib/studio/client";

type Suggestion = { key: string; reason: string; href: string; generatedAt: string };

export function GlobalCopilot() {
  const t = useTranslations("socialCopilot");
  const dashboard = useTranslations("product.dashboard");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function inspect() {
    setOpen(true);
    if (suggestion || loading) return;
    const workspaceId = getActiveWorkspaceId();
    if (!workspaceId) return;
    setLoading(true);
    try {
      const response = await fetch("/api/product-copilot/context", { headers: { "x-workspace-id": workspaceId }, cache: "no-store" });
      const result = await response.json() as { success?: boolean; suggestion?: Suggestion };
      if (response.ok && result.success && result.suggestion) setSuggestion(result.suggestion);
    } finally {
      setLoading(false);
    }
  }

  function dismiss() {
    if (suggestion) sessionStorage.setItem(`tasmeemai-copilot:${getActiveWorkspaceId()}:${suggestion.key}`, "dismissed");
    setDismissed(true);
  }

  const hidden = suggestion && (dismissed || sessionStorageValue(`tasmeemai-copilot:${getActiveWorkspaceId()}:${suggestion.key}`) === "dismissed");
  return <>
    <button type="button" onClick={inspect} aria-expanded={open} aria-controls="global-copilot-panel" className="fixed bottom-5 end-5 z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-stone-950 px-5 font-semibold text-white shadow-xl outline-none hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-amber-400"><Sparkles className="size-4 text-amber-300" />{t("button")}</button>
    {open && <aside id="global-copilot-panel" className="fixed bottom-20 end-5 z-40 w-[min(24rem,calc(100vw-2.5rem))] rounded-3xl border bg-card p-5 shadow-2xl" aria-labelledby="global-copilot-title">
      <div className="flex items-start gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800"><Sparkles className="size-5" /></div><div className="min-w-0 flex-1"><h2 id="global-copilot-title" className="font-semibold">{t("panelTitle")}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("panelHelp")}</p></div><button type="button" onClick={() => setOpen(false)} aria-label={t("close")} className="rounded-lg p-2 hover:bg-muted"><X className="size-4" /></button></div>
      <div className="mt-5">
        {loading ? <div className="flex min-h-32 items-center justify-center"><LoaderCircle className="size-5 animate-spin" /></div> : hidden ? <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">{t("dismissed")}</div> : suggestion ? <article className="rounded-2xl bg-stone-950 p-5 text-white"><p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-300">{t("nextAction")}</p><h3 className="mt-2 text-lg font-semibold">{dashboard(`actions.${suggestion.key}` as never)}</h3><p className="mt-2 text-sm leading-6 text-stone-300">{dashboard(`reasons.${suggestion.reason}` as never)}</p><div className="mt-4 flex items-center justify-between gap-3"><button type="button" onClick={dismiss} className="text-xs text-stone-400 hover:text-white">{t("dismiss")}</button><Link href={suggestion.href} className="inline-flex items-center gap-2 text-sm font-semibold text-amber-300">{t("openAction")}<ArrowUpRight className="size-4" /></Link></div></article> : <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">{t("contextUnavailable")}</div>}
      </div>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">{t("authorityBoundary")}</p>
    </aside>}
  </>;
}

function sessionStorageValue(key: string) {
  return typeof window === "undefined" ? null : window.sessionStorage.getItem(key);
}
