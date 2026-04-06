"use client";

import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { Button } from "@/components/ui/button";
import { FormPageLayout } from "./FormPageLayout";
import { FormInfoPanel } from "./FormInfoPanel";
import { ModelSelect } from "./ModelSelect";
import { LatestResultsInline } from "./LatestResultsInline";

const ASPECT_RATIOS = [
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
];

const BATCH_PRESETS = [1, 2, 4];
const DURATIONS = [5, 8, 10];

export function VideoForm() {
  const prompt = useSimpleStudioStore((s) => s.prompt);
  const setPrompt = useSimpleStudioStore((s) => s.setPrompt);
  const aspectRatio = useSimpleStudioStore((s) => s.aspectRatio);
  const setAspectRatio = useSimpleStudioStore((s) => s.setAspectRatio);
  const batchCount = useSimpleStudioStore((s) => s.batchCount);
  const setBatchCount = useSimpleStudioStore((s) => s.setBatchCount);
  const videoDuration = useSimpleStudioStore((s) => s.videoDuration);
  const setVideoDuration = useSimpleStudioStore((s) => s.setVideoDuration);
  const isGenerating = useSimpleStudioStore((s) => s.isGenerating);
  const generate = useSimpleStudioStore((s) => s.generate);

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
          estimatedCost={<span>{batchCount} video{batchCount > 1 ? "s" : ""}</span>}
          outputExample={
            <div className="aspect-video w-full rounded-md border bg-muted" />
          }
          tips={<p>Describe the motion and scene. Videos take longer to generate.</p>}
        />
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="video-prompt" className="mb-2 block text-sm font-medium">
            Prompt
          </label>
          <textarea
            id="video-prompt"
            className="min-h-32 w-full resize-y rounded-md border bg-background p-3 text-sm"
            placeholder="Describe the video you want to generate…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">Duration</label>
          <div className="flex gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                className={`rounded-md border px-3 py-1 text-xs ${
                  videoDuration === d
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted"
                }`}
                onClick={() => setVideoDuration(d)}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="video-model" className="mb-2 block text-sm font-medium">
            Model
          </label>
          <ModelSelect mode="video" id="video-model" />
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

        <LatestResultsInline mode="video" />
      </div>
    </FormPageLayout>
  );
}
