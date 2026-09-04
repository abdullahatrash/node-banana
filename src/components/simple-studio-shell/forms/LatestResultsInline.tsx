"use client";

import Link from "next/link";
import {
  useSimpleStudioStore,
  type Generation,
  type SimpleStudioMode,
} from "@/store/simpleStudioStore";
import { useTranslations } from "next-intl";
import { ArrowRightIcon } from "lucide-react";

interface LatestResultsInlineProps {
  mode: SimpleStudioMode;
}
const ERROR_KEYS = { MODEL_NOT_SELECTED: "errors.MODEL_NOT_SELECTED", RIGHTS_CONFIRMATION_REQUIRED: "errors.RIGHTS_CONFIRMATION_REQUIRED", TEXT_GENERATION_NOT_ADMITTED: "errors.TEXT_GENERATION_NOT_ADMITTED", PROVIDER_OUTCOME_UNKNOWN: "errors.PROVIDER_OUTCOME_UNKNOWN", GENERATION_FAILED: "errors.GENERATION_FAILED" } as const;
const RECOVERY_ERROR_KEYS = {
  MODEL_NOT_EXECUTABLE: "errors.MODEL_NOT_EXECUTABLE",
  CANONICAL_ARTIFACT_STORAGE_UNAVAILABLE: "errors.CANONICAL_ARTIFACT_STORAGE_UNAVAILABLE",
  MANAGED_REPLICATE_CREDENTIAL_UNAVAILABLE: "errors.MANAGED_REPLICATE_CREDENTIAL_UNAVAILABLE",
  DURABLE_REPLICATE_CREDENTIAL_REQUIRED: "errors.DURABLE_REPLICATE_CREDENTIAL_REQUIRED",
  ACCEPTED_BRAND_REVISION_REQUIRED: "errors.ACCEPTED_BRAND_REVISION_REQUIRED",
  VERIFIED_PROCESSING_REGION_REQUIRED: "errors.VERIFIED_PROCESSING_REGION_REQUIRED",
  PROCESSING_REGION_UNCONFIGURED: "errors.VERIFIED_PROCESSING_REGION_REQUIRED",
  PROCESSING_REGION_EVIDENCE_EXPIRED: "errors.VERIFIED_PROCESSING_REGION_REQUIRED",
  PROCESSING_REGION_ROUTE_NOT_VERIFIED: "errors.VERIFIED_PROCESSING_REGION_REQUIRED",
  GENERATION_PENDING_RECOVERY: "errors.GENERATION_PENDING_RECOVERY",
  MANAGED_CREDIT_QUOTE_DECLINED: "errors.MANAGED_CREDIT_QUOTE_DECLINED",
  BRAND_REFERENCE_ASSET_NOT_READY: "errors.BRAND_REFERENCE_ASSET_NOT_READY",
  PERSONA_USAGE_DENIED: "errors.PERSONA_USAGE_DENIED",
  PERSONA_MODEL_MISMATCH: "errors.PERSONA_MODEL_MISMATCH",
  BLITZ_REVISION_STALE: "errors.BLITZ_REVISION_STALE",
  BLITZ_BRIEF_SNAPSHOT_REQUIRED: "errors.BLITZ_BRIEF_SNAPSHOT_REQUIRED",
  BLITZ_GENERATION_CONTRACT_MISMATCH: "errors.BLITZ_GENERATION_CONTRACT_MISMATCH",
  SOURCE_ASSET_NOT_READY: "errors.SOURCE_INVALID",
  SOURCE_MEDIA_TYPE_MISMATCH: "errors.SOURCE_INVALID",
  SOURCE_DECODED_DIMENSIONS_REQUIRED: "errors.SOURCE_INVALID",
  SOURCE_9_16_REQUIRED: "errors.SOURCE_INVALID",
  SOURCE_CARDINALITY_INVALID: "errors.SOURCE_INVALID",
  SOURCE_ASSET_DUPLICATE: "errors.SOURCE_INVALID",
  SOURCE_VIDEO_FORMAT_UNSUPPORTED: "errors.SOURCE_INVALID",
  SOURCE_VIDEO_DURATION_INVALID: "errors.SOURCE_INVALID",
  OWNERSHIP_EVIDENCE_UNAVAILABLE: "errors.RIGHTS_EVIDENCE_REQUIRED",
  RIGHTS_SOURCE_COVERAGE_REQUIRED: "errors.RIGHTS_EVIDENCE_REQUIRED",
  RIGHTS_EVIDENCE_INVALID_OR_EXPIRED: "errors.RIGHTS_EVIDENCE_REQUIRED",
  REMIX_SCOPE_CONFLICT: "errors.RIGHTS_EVIDENCE_REQUIRED",
} as const;

const RECOVERY_ACTION_KEYS = {
  configure_model: "actions.configure_model",
  configure_storage: "actions.configure_storage",
  inspect_billing: "actions.inspect_billing",
  configure_provider_key: "actions.configure_provider_key",
  accept_brand: "actions.accept_brand",
  configure_region_policy: "actions.configure_region_policy",
  inspect_operations: "actions.inspect_operations",
  prepare_source: "actions.prepare_source",
  refresh_blitz: "actions.refresh_blitz",
  review_brand: "actions.review_brand",
  review_persona: "actions.review_persona",
  review_rights: "actions.review_rights",
  select_persona_model: "actions.select_persona_model",
  requeue_inspiration: "actions.requeue_inspiration",
} as const;

function ResultCard({ gen }: { gen: Generation }) {
  const t = useTranslations("simpleStudio.generation");
  const recovery = useTranslations("generationRecovery");
  if (gen.status === "pending" && gen.error === "GENERATION_PENDING_RECOVERY") {
    const actionKey = gen.nextActionCode && gen.nextActionCode in RECOVERY_ACTION_KEYS ? RECOVERY_ACTION_KEYS[gen.nextActionCode as keyof typeof RECOVERY_ACTION_KEYS] : null;
    return (
      <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" role="status">
        <p>{recovery("errors.GENERATION_PENDING_RECOVERY")}</p>
        {actionKey && gen.nextActionHref ? <Link href={gen.nextActionHref} className="mt-2 inline-flex min-h-8 items-center rounded-md border border-amber-500/50 px-2 font-semibold underline-offset-4 hover:underline">{recovery(actionKey)}</Link> : null}
      </div>
    );
  }
  if (gen.status === "pending" || gen.status === "generating") {
    return (
      <div className="rounded-md border bg-muted p-3 text-xs text-muted-foreground animate-pulse">
        {t("generating")}
      </div>
    );
  }

  if (gen.status === "failed") {
    const legacyErrorKey = gen.error && gen.error in ERROR_KEYS ? ERROR_KEYS[gen.error as keyof typeof ERROR_KEYS] : null;
    const recoveryErrorKey = gen.error && gen.error in RECOVERY_ERROR_KEYS ? RECOVERY_ERROR_KEYS[gen.error as keyof typeof RECOVERY_ERROR_KEYS] : null;
    const actionKey = gen.nextActionCode && gen.nextActionCode in RECOVERY_ACTION_KEYS ? RECOVERY_ACTION_KEYS[gen.nextActionCode as keyof typeof RECOVERY_ACTION_KEYS] : null;
    return (
      <div className="rounded-md border border-destructive p-3 text-xs text-destructive" role="alert">
        <p>{t("failed", { reason: recoveryErrorKey ? recovery(recoveryErrorKey) : t(legacyErrorKey ?? "errors.GENERATION_FAILED") })}</p>
        {actionKey && gen.nextActionHref ? (
          <Link href={gen.nextActionHref} className="mt-2 inline-flex min-h-8 items-center rounded-md border border-destructive/40 px-2 font-semibold underline-offset-4 hover:underline">
            {recovery(actionKey)}
          </Link>
        ) : null}
      </div>
    );
  }

  if (gen.mode === "copy") {
    return (
      <div dir="auto" className="rounded-md border p-3 text-sm whitespace-pre-wrap">
        {gen.result ?? "(no output)"}
      </div>
    );
  }

  if (gen.mode === "video") {
    return (
      <div className="rounded-md border overflow-hidden">
        {gen.result && (
          <video
            src={gen.result}
            className="aspect-[9/16] w-full bg-black object-contain"
            muted
            playsInline
            controls
          />
        )}
      </div>
    );
  }

  // photo
  return (
    <div className="rounded-md border overflow-hidden">
      {gen.result && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={gen.result}
          alt={gen.prompt}
          className="aspect-[9/16] w-full bg-muted object-contain"
        />
      )}
    </div>
  );
}

export function LatestResultsInline({ mode }: LatestResultsInlineProps) {
  const t = useTranslations("simpleStudio.generation");
  const modeGens = useSimpleStudioStore((s) => s.generationsByMode[mode]);

  if (modeGens.length === 0) return null;

  const latestBatchId = modeGens[0].batchId;
  const latestBatch = modeGens.filter((g) => g.batchId === latestBatchId);

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{t("latest")}</div>
        <Link
          href="/simple-studio/library"
          className="text-xs text-muted-foreground hover:underline"
        >
          {t("viewAll")} <ArrowRightIcon className="inline size-3 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </div>
      <div className="space-y-2">
        {latestBatch.map((gen) => (
          <ResultCard key={gen.id} gen={gen} />
        ))}
      </div>
    </div>
  );
}
