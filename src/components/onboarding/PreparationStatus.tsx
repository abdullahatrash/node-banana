import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import type { ParsedOnboardingSnapshot } from "@/lib/onboarding/schemas";
import type { InterfaceLocale } from "@/lib/onboarding/contracts";
import { useOnboardingCopy } from "./copy";

export function PreparationStatus({
  analysis,
  locale: _locale,
  onRetry,
  retrying = false,
}: {
  analysis: ParsedOnboardingSnapshot["analysis"];
  locale: InterfaceLocale;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const copy = useOnboardingCopy();
  if (!analysis || analysis.status.startsWith("failed_")) return null;
  const ready = analysis.status === "ready";
  const dispatchFailed = analysis.status === "queued" && analysis.errorCode === "WORKFLOW_DISPATCH_FAILED";
  return (
    <aside
      className="fixed end-4 top-4 z-30 flex max-w-[min(23rem,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-white/15 bg-stone-950/90 px-4 py-3 text-stone-100 shadow-2xl backdrop-blur-xl"
      aria-live="polite"
    >
      {dispatchFailed ? (
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-300" aria-hidden />
      ) : ready ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" aria-hidden />
      ) : (
        <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-amber-300" aria-hidden />
      )}
      <div>
        <p className="text-sm font-semibold">{dispatchFailed ? copy.preparationPaused : ready ? copy.preparationReady : copy.preparing}</p>
        <p className="mt-0.5 text-xs leading-5 text-stone-400">{dispatchFailed ? copy.preparationPausedDetail : ready ? copy.preparationReadyDetail : analysis.status === "queued" ? copy.preparationQueued : copy.preparingDetail}</p>
        {dispatchFailed && onRetry && <button type="button" onClick={onRetry} disabled={retrying} className="mt-2 rounded-lg bg-amber-300 px-3 py-2 text-xs font-semibold text-stone-950 disabled:opacity-50">{retrying ? copy.saving : copy.retryPreparation}</button>}
      </div>
    </aside>
  );
}
