"use client";

import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { Button } from "@/components/ui/button";
import { FormPageLayout } from "./FormPageLayout";
import { FormInfoPanel } from "./FormInfoPanel";
import { LatestResultsInline } from "./LatestResultsInline";

const TONES = ["professional", "casual", "creative", "persuasive"];
const PLATFORMS = ["general", "instagram", "x", "linkedin"];
const BATCH_PRESETS = [1, 4, 8];

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

  const disabled = isGenerating || prompt.trim().length === 0;

  return (
    <FormPageLayout
      infoPanel={
        <FormInfoPanel
          batchPresets={BATCH_PRESETS}
          currentBatchCount={batchCount}
          onBatchCountChange={setBatchCount}
          estimatedCost={<span>{batchCount} variant{batchCount > 1 ? "s" : ""}</span>}
          tips={<p>Give the model context: audience, product, and desired action.</p>}
        />
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="copy-prompt" className="mb-2 block text-sm font-medium">
            Prompt
          </label>
          <textarea
            id="copy-prompt"
            className="min-h-32 w-full resize-y rounded-md border bg-background p-3 text-sm"
            placeholder="What should the copy be about?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="copy-tone" className="mb-2 block text-sm font-medium">
              Tone
            </label>
            <select
              id="copy-tone"
              className="w-full rounded-md border bg-background p-2 text-sm"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
            >
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="copy-platform" className="mb-2 block text-sm font-medium">
              Platform
            </label>
            <select
              id="copy-platform"
              className="w-full rounded-md border bg-background p-2 text-sm"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="copy-model" className="mb-2 block text-sm font-medium">
            Model
          </label>
          <select
            id="copy-model"
            className="w-full rounded-md border bg-background p-2 text-sm"
            value={copyModelId}
            onChange={(e) => setCopyModelId(e.target.value)}
          >
            {LLM_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.provider})
              </option>
            ))}
          </select>
        </div>

        <Button
          type="button"
          size="lg"
          disabled={disabled}
          onClick={() => {
            void generate();
          }}
        >
          {isGenerating ? "Generating…" : "Generate"}
        </Button>

        <LatestResultsInline mode="copy" />
      </div>
    </FormPageLayout>
  );
}
