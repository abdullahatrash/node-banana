"use client";

import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { Button } from "@/components/ui/button";
import { FormPageLayout } from "./FormPageLayout";
import { FormInfoPanel } from "./FormInfoPanel";
import { LatestResultsInline } from "./LatestResultsInline";
import { GenerateProgress } from "./GenerateProgress";
import { useTranslations } from "next-intl";

const TONES = ["professional", "casual", "creative", "persuasive"] as const;
const PLATFORMS = ["general", "instagram", "x", "linkedin"] as const;
const BATCH_PRESETS = [1, 4, 8];

const OUTPUT_LANGUAGES = ["en", "ar", "both"] as const;

const LLM_MODELS: { id: string; name: string; provider: string }[] = [
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google" },
  { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", provider: "Google" },
  { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", provider: "Google" },
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "OpenAI" },
  { id: "gpt-4.1-nano", name: "GPT-4.1 Nano", provider: "OpenAI" },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "Anthropic" },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "Anthropic" },
];

export function CopyForm() {
  const t = useTranslations("simpleStudio.forms");
  const prompt = useSimpleStudioStore((s) => s.prompt);
  const setPrompt = useSimpleStudioStore((s) => s.setPrompt);
  const tone = useSimpleStudioStore((s) => s.tone);
  const setTone = useSimpleStudioStore((s) => s.setTone);
  const platform = useSimpleStudioStore((s) => s.platform);
  const setPlatform = useSimpleStudioStore((s) => s.setPlatform);
  const batchCount = useSimpleStudioStore((s) => s.batchCount);
  const setBatchCount = useSimpleStudioStore((s) => s.setBatchCount);
  const isGenerating = useSimpleStudioStore((s) => s.isGenerating);
  const generate = useSimpleStudioStore((s) => s.generate);
  const copyModelId = useSimpleStudioStore((s) => s.copyModelId);
  const setCopyModelId = useSimpleStudioStore((s) => s.setCopyModelId);
  const outputLanguage = useSimpleStudioStore((s) => s.outputLanguage);
  const setOutputLanguage = useSimpleStudioStore((s) => s.setOutputLanguage);

  const disabled = true;

  return (
    <FormPageLayout
      infoPanel={
        <FormInfoPanel
          batchPresets={BATCH_PRESETS}
          currentBatchCount={batchCount}
          onBatchCountChange={setBatchCount}
          estimatedCost={<span>{t("copy.count", { count: batchCount })}</span>}
          tips={<p>{t("copy.tip")}</p>}
        />
      }
    >
      <div className="space-y-4">
        <div role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{t("copy.unavailable")}</div>
        <div>
          <label htmlFor="copy-prompt" className="mb-2 block text-sm font-medium">
            {t("prompt")}
          </label>
          <textarea
            id="copy-prompt"
            className="min-h-32 w-full resize-y rounded-md border bg-background p-3 text-sm"
            placeholder={t("copy.placeholder")}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="copy-tone" className="mb-2 block text-sm font-medium">
              {t("copy.tone")}
            </label>
            <select
              id="copy-tone"
              className="w-full rounded-md border bg-background p-2 text-sm"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
            >
              {TONES.map((toneValue) => (
                <option key={toneValue} value={toneValue}>
                  {t(`tones.${toneValue}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="copy-platform" className="mb-2 block text-sm font-medium">
              {t("copy.platform")}
            </label>
            <select
              id="copy-platform"
              className="w-full rounded-md border bg-background p-2 text-sm"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {t(`platforms.${p}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">{t("copy.outputLanguage")}</label>
          <div className="flex gap-2">
            {OUTPUT_LANGUAGES.map((lang) => (
              <button
                key={lang}
                type="button"
                className={`flex-1 rounded-md border px-3 py-1 text-xs ${
                  outputLanguage === lang
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted"
                }`}
                onClick={() => setOutputLanguage(lang)}
              >
                {t(`languages.${lang}`)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="copy-model" className="mb-2 block text-sm font-medium">
            {t("model")}
          </label>
          <select
            id="copy-model"
            className="w-full rounded-md border bg-background p-2 text-sm"
            value={copyModelId}
            disabled
            onChange={(e) => setCopyModelId(e.target.value)}
          >
            {LLM_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.provider})
              </option>
            ))}
          </select>
        </div>

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
            {t("generate")}
          </Button>
        )}

        <LatestResultsInline mode="copy" />
      </div>
    </FormPageLayout>
  );
}
