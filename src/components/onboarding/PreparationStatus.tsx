import { CheckCircle2, LoaderCircle } from "lucide-react";
import type { ParsedOnboardingSnapshot } from "@/lib/onboarding/schemas";
import type { InterfaceLocale } from "@/lib/onboarding/contracts";
import { copyFor } from "./copy";

export function PreparationStatus({
  analysis,
  locale,
}: {
  analysis: ParsedOnboardingSnapshot["analysis"];
  locale: InterfaceLocale;
}) {
  if (!analysis || analysis.status.startsWith("failed_")) return null;
  const copy = copyFor(locale);
  const ready = analysis.status === "ready";
  return (
    <aside
      className="fixed end-4 top-4 z-30 flex max-w-[min(23rem,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-white/15 bg-stone-950/90 px-4 py-3 text-stone-100 shadow-2xl backdrop-blur-xl"
      aria-live="polite"
    >
      {ready ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" aria-hidden />
      ) : (
        <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-amber-300" aria-hidden />
      )}
      <div>
        <p className="text-sm font-semibold">{copy.preparing}</p>
        <p className="mt-0.5 text-xs leading-5 text-stone-400">{copy.preparingDetail}</p>
      </div>
    </aside>
  );
}
