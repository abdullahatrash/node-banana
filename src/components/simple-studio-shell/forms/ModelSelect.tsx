"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleAlertIcon } from "lucide-react";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { getActiveWorkspaceId } from "@/lib/studio/client";
import { useTranslations } from "next-intl";
import type { GenerationReadiness } from "@/lib/model-routing/readiness";
import type { ExecutionPriceUsd, GenerationCapability } from "@/lib/model-routing/types";

interface ProviderModel {
  model: string;
  label: string;
  provider: string;
  capabilities?: string[];
  qualification: { status: "unqualified" } | { status: "qualified"; version: string; inputSchemaDigest: string; executionPriceUsd: ExecutionPriceUsd };
}

interface ModelSelectProps {
  mode: "photo" | "video" | "copy";
  id: string;
  requiredCapability?: GenerationCapability;
}

type ReadinessGate = "qualifiedModel" | "acceptedBrand" | "canonicalMediaStorage" | "processingRegion" | "byokCredential" | "managedCredential" | "managedCreditRate";

export function ModelSelect({ mode, id, requiredCapability }: ModelSelectProps) {
  const t = useTranslations("simpleStudio.modelSelect");
  const pricingT = useTranslations("pricingMetering");
  const readinessT = useTranslations("generationReadiness");
  const locale = typeof document === "undefined" ? undefined : document.documentElement.lang || undefined;
  const selectedModelId = useSimpleStudioStore((s) => s.selectedModelId);
  const setSelectedModel = useSimpleStudioStore((s) => s.setSelectedModel);
  const sourceMediaType = useSimpleStudioStore((s) => s.sourceMediaType);
  const referenceImageCount = useSimpleStudioStore((s) => s.referenceImages.length);
  const fundingMode = useSimpleStudioStore((s) => s.fundingMode);
  const capability = requiredCapability ?? (mode === "copy" ? "text_generation" : mode === "video"
    ? sourceMediaType === "video" ? "video_to_video" : sourceMediaType === "image" ? "image_to_video" : "text_to_video"
    : referenceImageCount > 0 ? "image_to_image" : "text_to_image");

  const [models, setModels] = useState<ProviderModel[]>([]);
  const [readiness, setReadiness] = useState<GenerationReadiness | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setHasError(false);

    const workspaceId = getActiveWorkspaceId();
    if (!workspaceId) { setModels([]); setReadiness(null); setHasError(true); setIsLoading(false); return () => controller.abort(); }
    fetch("/api/studio/model-routing/catalog", {
      headers: { "x-workspace-id": workspaceId },
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.success) {
          setReadiness(data.generationReadiness ?? null);
          const seen = new Set<string>();
          const unique = (data.items || []).filter((m: ProviderModel) => {
            const supported = m.capabilities?.includes(capability);
            if (m.provider !== "replicate" || m.qualification.status !== "qualified" || !supported || seen.has(m.model)) return false;
            seen.add(m.model);
            return true;
          });
          setModels(unique);
          const selected = unique.find((item: ProviderModel) => item.model === selectedModelId);
          if (selected?.qualification.status === "qualified") {
            setSelectedModel(selected.model, selected.provider, selected.label, selected.qualification.version, selected.qualification.inputSchemaDigest, selected.qualification.executionPriceUsd);
          } else {
            const replacement = unique[0] as ProviderModel | undefined;
            if (replacement?.qualification.status === "qualified") {
              setSelectedModel(replacement.model, replacement.provider, replacement.label, replacement.qualification.version, replacement.qualification.inputSchemaDigest, replacement.qualification.executionPriceUsd);
            } else {
              setSelectedModel(null, null, null);
            }
          }
        } else {
          setReadiness(null);
          setHasError(true);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === "AbortError") return;
        setReadiness(null);
        setHasError(true);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [capability, selectedModelId, setSelectedModel]);

  const sorted = [...models].sort((a, b) => a.label.localeCompare(b.label));
  const priceLabel = (price: ExecutionPriceUsd) => price.basis === "components"
    ? price.components.map((item) => t("price", { amount: new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(item.amount), basis: pricingT(item.basis) })).join(" + ")
    : t("price", { amount: new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(price.amount), basis: t(`basis.${price.basis}`) });

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "") {
      setSelectedModel(null, null, null);
      return;
    }
    const model = models.find((m) => m.model === value);
    if (model?.qualification.status === "qualified") {
      setSelectedModel(model.model, model.provider, model.label, model.qualification.version, model.qualification.inputSchemaDigest, model.qualification.executionPriceUsd);
    }
  };

  const blockers: Array<{ key: ReadinessGate; href: string }> = [];
  if (readiness) {
    if (!readiness.qualifiedCapabilities.includes(capability)) blockers.push({ key: "qualifiedModel", href: "/studio/model-routing" });
    if (!readiness.gates.acceptedBrand) blockers.push({ key: "acceptedBrand", href: "/brand" });
    if (mode !== "copy" && !readiness.gates.canonicalMediaStorage) blockers.push({ key: "canonicalMediaStorage", href: "/settings?section=storage" });
    if (!readiness.gates.processingRegion) blockers.push({ key: "processingRegion", href: "/settings?section=data" });
    if (fundingMode === "byok" && !readiness.gates.byokCredential) blockers.push({ key: "byokCredential", href: "/settings?section=providers" });
    if (fundingMode === "managed" && !readiness.gates.managedCredential) blockers.push({ key: "managedCredential", href: "/billing" });
    if (fundingMode === "managed" && !readiness.gates.managedCreditRate) blockers.push({ key: "managedCreditRate", href: "/billing" });
  }

  return (
    <div className="space-y-2">
      <select
        id={id}
        dir="auto"
        className="w-full rounded-md border bg-background p-2 text-sm"
        value={selectedModelId ?? ""}
        onChange={handleChange}
        disabled={isLoading && models.length === 0}
      >
        <option value="">{t("select")}</option>
        {isLoading && models.length === 0 && (
          <option disabled>{t("loading")}</option>
        )}
        {hasError && !isLoading && (
          <option disabled>{t("workspaceRequired")}</option>
        )}
        {!hasError && !isLoading && sorted.length === 0 && <option disabled>{t("none")}</option>}
        {sorted.map((m) => (
          <option key={m.model} value={m.model} dir="auto">
            {m.qualification.status === "qualified" ? `${m.label} · ${priceLabel(m.qualification.executionPriceUsd)}` : m.label}
          </option>
        ))}
      </select>
      {blockers.length > 0 ? (
        <aside role="status" className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-start text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="flex items-center gap-2 text-xs font-semibold">
            <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
            {readinessT("title")}
          </p>
          <p className="mt-1 text-xs leading-5 opacity-80">{readinessT("description")}</p>
          <ul className="mt-2 space-y-2">
            {blockers.map((blocker) => (
              <li key={blocker.key} className="flex items-start justify-between gap-3 text-xs">
                <span>
                  <span className="block font-semibold">{readinessT(`gates.${blocker.key}.title`)}</span>
                  <span className="mt-0.5 block leading-5 opacity-80">{readinessT(`gates.${blocker.key}.detail`)}</span>
                </span>
                <Link href={blocker.href} className="shrink-0 font-semibold underline underline-offset-4">
                  {readinessT(`gates.${blocker.key}.action`)}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
