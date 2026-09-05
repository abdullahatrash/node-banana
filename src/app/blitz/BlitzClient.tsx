"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  Check,
  ExternalLink,
  LoaderCircle,
  Settings2,
  Square,
  ThumbsDown,
} from "lucide-react";
import {
  ProductRequestError,
  productRequest,
} from "@/components/product-surfaces/ProductApi";
import { GenerationAdmissionPanel } from "@/components/simple-studio-shell/forms/GenerationAdmissionPanel";
import { ModelSelect } from "@/components/simple-studio-shell/forms/ModelSelect";
import { VideoDurationControl } from "@/components/simple-studio-shell/forms/VideoDurationControl";
import { runAdmittedStudioGeneration } from "@/lib/model-routing/studio-generation-client";
import {
  requestStudioManagedCreditQuoteConfirmation,
  useSimpleStudioStore,
} from "@/store/simpleStudioStore";
import {
  BLITZ_REJECTION_CODES,
  brandAwareRemixBriefSchema,
} from "@/lib/product-surfaces/definitions";

type Item = {
  id: string;
  title: string;
  revision: number;
  payload: Record<string, unknown>;
};

type SourceMediaType = "image" | "video";
type RightsBasis = "owned" | "licensed" | "public_domain" | "consented";
type PermittedRemix = "reference_only" | "transform" | "derivative";

function sourceMediaType(value: unknown): SourceMediaType | null {
  return value === "image" || value === "video" ? value : null;
}

function rightsBasis(value: unknown): RightsBasis | null {
  return ["owned", "licensed", "public_domain", "consented"].includes(
    String(value),
  )
    ? (value as RightsBasis)
    : null;
}

function permittedRemix(value: unknown): PermittedRemix | null {
  return ["reference_only", "transform", "derivative"].includes(String(value))
    ? (value as PermittedRemix)
    : null;
}

export function BlitzClient({
  items,
  generatedAt,
}: {
  items: Item[];
  generatedAt: string;
}) {
  const t = useTranslations("product.blitzQueue") as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  const format = useFormatter();
  const router = useRouter();
  const controller = useRef<AbortController | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionCodes, setRejectionCodes] = useState<string[]>([]);
  const [rejectionNote, setRejectionNote] = useState("");
  const item = items[index];
  const modelId = useSimpleStudioStore((state) => state.selectedModelId);
  const modelProvider = useSimpleStudioStore(
    (state) => state.selectedModelProvider,
  );
  const modelVersion = useSimpleStudioStore(
    (state) => state.selectedModelVersion,
  );
  const modelSchema = useSimpleStudioStore(
    (state) => state.selectedModelSchemaDigest,
  );
  const videoDuration = useSimpleStudioStore((state) => state.videoDuration);
  const fundingMode = useSimpleStudioStore((state) => state.fundingMode);
  const setSourceImage = useSimpleStudioStore((state) => state.setSourceImage);

  useEffect(() => {
    const sourceAssetId =
      typeof item?.payload.sourceAssetId === "string"
        ? item.payload.sourceAssetId
        : null;
    const mediaType = sourceMediaType(item?.payload.sourceMediaType);
    setSourceImage(sourceAssetId ? `asset:${sourceAssetId}` : null, mediaType);
  }, [item, setSourceImage]);

  async function decide(decision: "accepted" | "rejected") {
    if (!item) return;
    setBusy(true);
    setError("");
    const abort = new AbortController();
    controller.current = abort;

    try {
      let generation: {
        assetId: string;
        intentId: string;
        operationId: string;
      } | null = null;
      let similarityEvidenceId: string | null = null;

      if (decision === "accepted") {
        const sourceAssetId =
          typeof item.payload.sourceAssetId === "string"
            ? item.payload.sourceAssetId
            : null;
        const mediaType = sourceMediaType(item.payload.sourceMediaType);
        const basis = rightsBasis(item.payload.rightsBasis);
        const remix = permittedRemix(item.payload.permittedRemix);
        const brief = brandAwareRemixBriefSchema.safeParse(
          item.payload.remixBrief,
        );
        const metadataOnly = item.payload.sourceUsage === "metadata_topic_only";

        if (
          (!metadataOnly && (!sourceAssetId || !mediaType || !basis || !remix)) ||
          (metadataOnly && (sourceAssetId || mediaType || basis || remix)) ||
          !modelId ||
          modelProvider !== "replicate" ||
          !modelVersion ||
          !modelSchema ||
          !brief.success
        ) {
          throw new Error("BLITZ_GENERATION_REQUIRED");
        }

        const generated = await runAdmittedStudioGeneration({
          prompt: brief.data.provider.prompt,
          model: {
            provider: "replicate",
            model: modelId,
            version: modelVersion,
            inputSchemaDigest: modelSchema,
          },
          mode: "video",
          sourceMediaType: metadataOnly ? null : mediaType,
          sourceAssetIds: metadataOnly ? [] : [sourceAssetId!],
          quantity: videoDuration,
          fundingMode,
          contentLanguage:
            item.payload.contentLanguage === "en" ||
            item.payload.contentLanguage === "mixed"
              ? item.payload.contentLanguage
              : "ar",
          arabicVariety:
            typeof item.payload.arabicVariety === "string"
              ? (item.payload.arabicVariety as
                  | "msa"
                  | "gulf"
                  | "egyptian"
                  | "levantine"
                  | "maghrebi")
              : null,
          rightsBasis: metadataOnly ? "owned" : basis!,
          permittedRemix: metadataOnly ? "reference_only" : remix!,
          rightsEvidenceIds: metadataOnly ? [] : Array.isArray(item.payload.rightsEvidenceIds)
            ? item.payload.rightsEvidenceIds.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          remixBrief: {
            preserve: brief.data.provider.preserve,
            transform: brief.data.provider.transform,
            avoid: brief.data.provider.avoid,
          },
          blitzContext: {
            itemId: item.id,
            expectedRevision: item.revision,
          },
          idempotencyKey: crypto.randomUUID(),
          signal: abort.signal,
          confirmManagedCreditQuote:
            requestStudioManagedCreditQuoteConfirmation,
        });
        if (!generated.assetId) throw new Error("BLITZ_GENERATION_REQUIRED");

        generation = {
          assetId: generated.assetId,
          intentId: generated.intentId,
          operationId: generated.operationId,
        };
        if (!metadataOnly) {
          const evaluated = await productRequest("/api/blitz/similarity", {
            itemId: item.id,
            expectedRevision: item.revision,
            candidateAssetId: generated.assetId,
          });
          const evidence = evaluated.evidence as { status?: unknown } | undefined;
          if (
            typeof evaluated.evidenceId !== "string" ||
            evidence?.status !== "passed"
          ) {
            throw new ProductRequestError("BLITZ_SIMILARITY_BLOCKED");
          }
          similarityEvidenceId = evaluated.evidenceId;
        }
      }

      const reasons =
        decision === "rejected"
          ? rejectionCodes.map((code, position) => ({
              code,
              note: position === 0 ? rejectionNote : "",
            }))
          : [];
      await productRequest("/api/blitz/decision", {
        itemId: item.id,
        expectedRevision: item.revision,
        decision,
        reasons,
        generation,
        similarityEvidenceId,
        idempotencyKey: crypto.randomUUID(),
      });
      setRejectOpen(false);
      setRejectionCodes([]);
      setRejectionNote("");
      if (index < items.length - 1) setIndex((value) => value + 1);
      else router.refresh();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setError(t("similarity.cancelled"));
      } else if (
        cause instanceof ProductRequestError &&
        cause.code.startsWith("BLITZ_SIMILARITY_")
      ) {
        setError(
          t(
            `similarity.${cause.code === "BLITZ_SIMILARITY_BLOCKED" ? "blocked" : "unavailable"}`,
          ),
        );
      } else {
        setError(t("error"));
      }
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }

  if (!item) {
    return (
      <div className="rounded-3xl border border-dashed p-12 text-center">
        <h2 className="text-xl font-semibold">{t("emptyTitle")}</h2>
        <p className="mt-2 text-muted-foreground">{t("empty")}</p>
        <Link
          href="/inspiration"
          className="mt-5 inline-flex rounded-xl bg-amber-300 px-5 py-3 font-semibold text-stone-950"
        >
          {t("browse")}
        </Link>
      </div>
    );
  }

  const parsedBrief = brandAwareRemixBriefSchema.safeParse(
    item.payload.remixBrief,
  );
  const influences = parsedBrief.success
    ? parsedBrief.data.influencePlan.map((influence) => influence.kind)
    : ((item.payload.remixBrief as { influences?: string[] } | undefined)
        ?.influences ?? []);
  const comparison =
    item.payload.sourceComparison &&
    typeof item.payload.sourceComparison === "object"
      ? (item.payload.sourceComparison as {
          views?: number;
          likes?: number;
          observedAt?: string;
        })
      : null;
  const observedAt = comparison?.observedAt
    ? new Date(comparison.observedAt)
    : null;
  const freshness =
    observedAt &&
    new Date(generatedAt).getTime() - observedAt.getTime() <= 86_400_000
      ? "current"
      : observedAt
        ? "stale"
        : "unknown";
  const selectedFormat =
    typeof item.payload.format === "string"
      ? item.payload.format
      : "talking_head_ugc";

  return (
    <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[.8fr_1.2fr]">
      <aside className="rounded-3xl border bg-card p-6">
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-600">
          {t("remixedFrom")}
        </p>
        <h2 dir="auto" className="mt-3 text-xl font-semibold">
          {item.title}
        </h2>
        <a
          href={String(item.payload.sourceAttribution)}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex items-center gap-2 text-sm text-amber-700"
        >
          <ExternalLink className="size-4" />
          {t("viewOriginal")}
        </a>
        <Link
          href={`/content?format=${encodeURIComponent(selectedFormat)}&fromBlitz=${encodeURIComponent(item.id)}`}
          className="ms-4 mt-5 inline-flex items-center gap-2 text-sm text-amber-700"
        >
          <Settings2 className="size-4" />
          {t("configure")}
        </Link>
        <div className="mt-6 rounded-xl border p-3 text-xs">
          <p className="font-semibold">{t("sourceEvidence")}</p>
          <p className="mt-2">
            {t("sourceMetrics", {
              views: comparison?.views ?? 0,
              likes: comparison?.likes ?? 0,
            })}
          </p>
          <p className="mt-1 text-muted-foreground">
            {observedAt
              ? t("sourceObserved", {
                  time: format.dateTime(observedAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                })
              : t("sourceUnknown")}
          </p>
          <p className="mt-1 font-semibold">{t(`freshness.${freshness}`)}</p>
        </div>
        <h3 className="mt-8 font-semibold">{t("influence")}</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {influences.map((value) => (
            <span
              key={value}
              className="rounded-full bg-muted px-3 py-1.5 text-xs"
            >
              {t(`influences.${value}`)}
            </span>
          ))}
        </div>
        {parsedBrief.success ? (
          <div className="mt-5 rounded-xl border p-3 text-xs">
            <p className="font-semibold">{t("brandBrief")}</p>
            <p dir="auto" className="mt-2 text-muted-foreground">
              {parsedBrief.data.brandDirection.angle}
            </p>
            <p dir="auto" className="mt-2 text-muted-foreground">
              {parsedBrief.data.brandDirection.audience}
            </p>
          </div>
        ) : null}
        <p className="mt-5 rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">
          {t("expressionExcluded")}
        </p>
      </aside>

      <section className="rounded-3xl bg-stone-950 p-6 text-white sm:p-8">
        <div className="mx-auto aspect-[9/16] max-h-[56vh] max-w-sm rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_50%_20%,rgba(251,191,36,.22),transparent_40%),linear-gradient(160deg,#292524,#0c0a09)] p-6 shadow-2xl">
          <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs">
            {t("proposal")}
          </span>
          <h2 dir="auto" className="mt-10 text-3xl font-semibold leading-tight">
            {item.title}
          </h2>
          <p
            dir="auto"
            className="mt-5 whitespace-pre-line leading-7 text-stone-300"
          >
            {String(item.payload.rationale)}
          </p>
        </div>
        <div className="mx-auto mt-5 max-w-sm">
          <ModelSelect mode="video" id="blitz-generation-model" />
        </div>
        <VideoDurationControl inverse className="mx-auto mt-4 max-w-sm" />
        <GenerationAdmissionPanel runs={1} quantityPerRun={videoDuration} />

        {rejectOpen ? (
          <div className="mx-auto mt-4 max-w-sm rounded-xl border border-white/15 p-4">
            <p className="text-sm font-semibold">{t("rejectWhy")}</p>
            <div className="mt-3 grid gap-2">
              {BLITZ_REJECTION_CODES.map((code) => (
                <label key={code} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={rejectionCodes.includes(code)}
                    onChange={(event) =>
                      setRejectionCodes((current) =>
                        event.target.checked
                          ? [...current, code]
                          : current.filter((value) => value !== code),
                      )
                    }
                  />
                  {t(`rejectionReasons.${code}`)}
                </label>
              ))}
            </div>
            <textarea
              dir="auto"
              value={rejectionNote}
              onChange={(event) =>
                setRejectionNote(event.target.value.slice(0, 300))
              }
              placeholder={t("rejectNote")}
              className="mt-3 min-h-20 w-full rounded-lg border border-white/15 bg-white/5 p-2 text-sm"
            />
            <button
              onClick={() => decide("rejected")}
              disabled={busy || rejectionCodes.length === 0}
              className="mt-3 min-h-10 w-full rounded-lg bg-white/10 px-3 text-sm font-semibold disabled:opacity-50"
            >
              {t("confirmReject")}
            </button>
          </div>
        ) : null}

        <div className="mx-auto mt-3 grid max-w-sm grid-cols-2 gap-3">
          <button
            onClick={
              busy
                ? () => controller.current?.abort()
                : () => setRejectOpen((value) => !value)
            }
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 font-semibold"
          >
            {busy ? (
              <Square className="size-4" />
            ) : (
              <ThumbsDown className="size-4" />
            )}
            {busy ? t("similarity.cancel") : t("reject")}
          </button>
          <button
            onClick={() => decide("accepted")}
            disabled={busy || !parsedBrief.success}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-300 font-semibold text-stone-950 disabled:opacity-50"
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {error ? t("similarity.retry") : t("accept")}
          </button>
        </div>
        <p className="mt-4 text-center text-xs text-stone-500">
          {t(parsedBrief.success ? "acceptanceBoundary" : "requeueRequired")}
        </p>
        {busy ? (
          <p role="status" className="mt-3 text-center text-sm text-stone-300">
            {t("similarity.running")}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-center text-sm text-red-300">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
