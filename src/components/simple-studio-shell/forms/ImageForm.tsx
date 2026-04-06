"use client";

import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { Button } from "@/components/ui/button";
import { FormPageLayout } from "./FormPageLayout";
import { FormInfoPanel } from "./FormInfoPanel";

const ASPECT_RATIOS = [
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:5", label: "4:5" },
];

const BATCH_PRESETS = [1, 4, 8, 12];

export function ImageForm() {
  const prompt = useSimpleStudioStore((s) => s.prompt);
  const setPrompt = useSimpleStudioStore((s) => s.setPrompt);
  const aspectRatio = useSimpleStudioStore((s) => s.aspectRatio);
  const setAspectRatio = useSimpleStudioStore((s) => s.setAspectRatio);
  const batchCount = useSimpleStudioStore((s) => s.batchCount);
  const setBatchCount = useSimpleStudioStore((s) => s.setBatchCount);
  const isGenerating = useSimpleStudioStore((s) => s.isGenerating);
  const generate = useSimpleStudioStore((s) => s.generate);
  const selectedModelName = useSimpleStudioStore((s) => s.selectedModelName);

  const disabled = isGenerating || prompt.trim().length === 0;

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
          estimatedCost={<span>{batchCount} image{batchCount > 1 ? "s" : ""}</span>}
          outputExample={
            <div className="aspect-square w-full rounded-md border bg-muted" />
          }
          tips={<p>Describe the scene, style, and subject for best results.</p>}
        />
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="image-prompt" className="mb-2 block text-sm font-medium">
            Prompt
          </label>
          <textarea
            id="image-prompt"
            className="min-h-32 w-full resize-y rounded-md border bg-background p-3 text-sm"
            placeholder="Describe the image you want to generate…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="text-xs text-muted-foreground">
          Model: {selectedModelName || "Auto"}
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
      </div>
    </FormPageLayout>
  );
}
