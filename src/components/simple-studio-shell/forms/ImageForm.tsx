"use client";

import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { Button } from "@/components/ui/button";
import { FormPageLayout } from "./FormPageLayout";
import { FormInfoPanel } from "./FormInfoPanel";
import { ModelSelect } from "./ModelSelect";
import { LatestResultsInline } from "./LatestResultsInline";
import { GenerateProgress } from "./GenerateProgress";
import { GenerationAdmissionPanel } from "./GenerationAdmissionPanel";
import { useTranslations } from "next-intl";

const ASPECT_RATIOS = [
  { value: "9:16", label: "9:16" },
];

const BATCH_PRESETS = [1, 4, 8, 12];

const MAX_REFERENCE_IMAGES = 3;

export function ImageForm() {
  const t = useTranslations("simpleStudio.forms");
  const prompt = useSimpleStudioStore((s) => s.prompt);
  const setPrompt = useSimpleStudioStore((s) => s.setPrompt);
  const aspectRatio = useSimpleStudioStore((s) => s.aspectRatio);
  const setAspectRatio = useSimpleStudioStore((s) => s.setAspectRatio);
  const batchCount = useSimpleStudioStore((s) => s.batchCount);
  const setBatchCount = useSimpleStudioStore((s) => s.setBatchCount);
  const isGenerating = useSimpleStudioStore((s) => s.isGenerating);
  const isRewriting = useSimpleStudioStore((s) => s.isRewriting);
  const generate = useSimpleStudioStore((s) => s.generate);
  const referenceImages = useSimpleStudioStore((s) => s.referenceImages);
  const setReferenceImages = useSimpleStudioStore((s) => s.setReferenceImages);
  const rewriteEnabled = useSimpleStudioStore((s) => s.rewriteEnabled);
  const setRewriteEnabled = useSimpleStudioStore((s) => s.setRewriteEnabled);
  const rewrittenPrompt = useSimpleStudioStore((s) => s.rewrittenPrompt);
  const selectedModelId = useSimpleStudioStore((s) => s.selectedModelId);
  const rightsConfirmed = useSimpleStudioStore((s) => s.rightsConfirmed);

  const disabled = isGenerating || isRewriting || prompt.trim().length === 0 || !selectedModelId || !rightsConfirmed;

  const handleReferenceImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setReferenceImages([...referenceImages, reader.result]);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <FormPageLayout
      infoPanel={
        <FormInfoPanel
          aspectRatios={ASPECT_RATIOS}
          batchPresets={BATCH_PRESETS}
          currentAspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          currentBatchCount={batchCount}
          onBatchCountChange={setBatchCount}
          estimatedCost={<span>{t("image.count", { count: batchCount })}</span>}
          outputExample={
            <div className="aspect-[9/16] w-full rounded-md border bg-muted" />
          }
          tips={<p>{t("image.tip")}</p>}
        />
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="image-prompt" className="mb-2 block text-sm font-medium">
            {t("prompt")}
          </label>
          <textarea
            id="image-prompt"
            dir="auto"
            className="min-h-32 w-full resize-y rounded-md border bg-background p-3 text-sm"
            placeholder={t("image.placeholder")}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between">
          <label htmlFor="image-rewrite" className="text-sm font-medium">
            {t("enhance")}
          </label>
          <button
            id="image-rewrite"
            type="button"
            role="switch"
            aria-checked={rewriteEnabled}
            disabled
            title={t("enhancePaused")}
            onClick={() => setRewriteEnabled(!rewriteEnabled)}
            className={`relative h-5 w-9 rounded-full transition-colors ${
              rewriteEnabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`absolute start-0.5 top-0.5 h-4 w-4 rounded-full bg-background transition-all ${
                rewriteEnabled ? "translate-x-4 rtl:-translate-x-4" : ""
              }`}
            />
          </button>
        </div>

        {rewriteEnabled && rewrittenPrompt && (
          <div className="rounded-md border bg-muted/40 p-3">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-primary">
              {t("enhanced")}
            </div>
            <p className="text-xs leading-relaxed" dir="auto">
              {rewrittenPrompt}
            </p>
          </div>
        )}

        <div>
          <label className="mb-2 block text-sm font-medium">
            {t("image.references")}
          </label>
          <div className="flex flex-wrap gap-2">
            {referenceImages.map((img, i) => (
              <div
                key={i}
                className="relative h-20 w-20 overflow-hidden rounded-md border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img}
                  alt={t("image.referenceAlt", { number: i + 1 })}
                  className="h-full w-full object-contain"
                />
                <button
                  type="button"
                  aria-label={t("image.removeReference", { number: i + 1 })}
                  onClick={() =>
                    setReferenceImages(referenceImages.filter((_, j) => j !== i))
                  }
                  className="absolute end-0 top-0 flex h-5 w-5 items-center justify-center rounded-bl bg-destructive text-xs text-destructive-foreground"
                >
                  ×
                </button>
              </div>
            ))}
            {referenceImages.length < MAX_REFERENCE_IMAGES && (
              <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-md border border-dashed text-muted-foreground transition-colors hover:border-foreground/40">
                <span className="text-lg">+</span>
                <input
                  type="file"
                  accept="image/*"
                  aria-label={t("image.addReference")}
                  className="hidden"
                  onChange={handleReferenceImageUpload}
                />
              </label>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("image.referenceHint", { count: MAX_REFERENCE_IMAGES })}
          </p>
        </div>

        <div>
          <label htmlFor="image-model" className="mb-2 block text-sm font-medium">
            {t("model")}
          </label>
          <ModelSelect mode="photo" id="image-model" />
        </div>

        <GenerationAdmissionPanel />

        {isGenerating ? (
          <GenerateProgress />
        ) : (
          <Button
            type="button"
            size="lg"
            disabled={disabled}
            onClick={() => {
              void generate();
            }}
          >
            {isRewriting ? t("enhancing") : t("generate")}
          </Button>
        )}

        <LatestResultsInline mode="photo" />
      </div>
    </FormPageLayout>
  );
}
