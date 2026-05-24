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

const BATCH_PRESETS = [1, 2, 4, 8];
const DURATIONS = [4, 5, 6, 8, 10];

const DIALOGUE_LANGUAGES: { value: "en" | "ar"; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ar", label: "عربي" },
];

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
  const isRewriting = useSimpleStudioStore((s) => s.isRewriting);
  const generate = useSimpleStudioStore((s) => s.generate);
  const sourceImage = useSimpleStudioStore((s) => s.sourceImage);
  const setSourceImage = useSimpleStudioStore((s) => s.setSourceImage);
  const rewriteEnabled = useSimpleStudioStore((s) => s.rewriteEnabled);
  const setRewriteEnabled = useSimpleStudioStore((s) => s.setRewriteEnabled);
  const rewrittenPrompt = useSimpleStudioStore((s) => s.rewrittenPrompt);
  const dialogueEnabled = useSimpleStudioStore((s) => s.dialogueEnabled);
  const setDialogueEnabled = useSimpleStudioStore((s) => s.setDialogueEnabled);
  const dialogueLanguage = useSimpleStudioStore((s) => s.dialogueLanguage);
  const setDialogueLanguage = useSimpleStudioStore((s) => s.setDialogueLanguage);
  const dialogueText = useSimpleStudioStore((s) => s.dialogueText);
  const setDialogueText = useSimpleStudioStore((s) => s.setDialogueText);

  const disabled = isGenerating || isRewriting || prompt.trim().length === 0;

  const handleSourceImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setSourceImage(reader.result);
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

        <div className="flex items-center justify-between">
          <label htmlFor="video-rewrite" className="text-sm font-medium">
            AI Prompt Enhance
          </label>
          <button
            id="video-rewrite"
            type="button"
            role="switch"
            aria-checked={rewriteEnabled}
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
              Enhanced prompt
            </div>
            <p className="text-xs leading-relaxed" dir="auto">
              {rewrittenPrompt}
            </p>
          </div>
        )}

        <div>
          <label className="mb-2 block text-sm font-medium">
            Source image (optional, for image-to-video)
          </label>
          {sourceImage ? (
            <div className="relative h-24 w-24 overflow-hidden rounded-md border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sourceImage}
                alt="Source"
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                aria-label="Remove source image"
                onClick={() => setSourceImage(null)}
                className="absolute end-0 top-0 flex h-5 w-5 items-center justify-center rounded-bl bg-destructive text-xs text-destructive-foreground"
              >
                ×
              </button>
            </div>
          ) : (
            <label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-md border border-dashed text-muted-foreground transition-colors hover:border-foreground/40">
              <span className="text-lg">+</span>
              <input
                type="file"
                accept="image/*"
                aria-label="Add source image"
                className="hidden"
                onChange={handleSourceImageUpload}
              />
            </label>
          )}
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
          <p className="mt-1 text-[11px] text-muted-foreground">
            Duration depends on model (Veo: 4-8s, Kling: 5-10s).
          </p>
        </div>

        <div className="flex items-center justify-between">
          <label htmlFor="video-dialogue" className="text-sm font-medium">
            Include dialogue
          </label>
          <button
            id="video-dialogue"
            type="button"
            role="switch"
            aria-checked={dialogueEnabled}
            onClick={() => setDialogueEnabled(!dialogueEnabled)}
            className={`relative h-5 w-9 rounded-full transition-colors ${
              dialogueEnabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`absolute start-0.5 top-0.5 h-4 w-4 rounded-full bg-background transition-all ${
                dialogueEnabled ? "translate-x-4 rtl:-translate-x-4" : ""
              }`}
            />
          </button>
        </div>

        {dialogueEnabled && (
          <>
            <div>
              <label className="mb-2 block text-sm font-medium">
                Dialogue language
              </label>
              <div className="flex gap-2">
                {DIALOGUE_LANGUAGES.map((lang) => (
                  <button
                    key={lang.value}
                    type="button"
                    className={`flex-1 rounded-md border px-3 py-1 text-xs ${
                      dialogueLanguage === lang.value
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted"
                    }`}
                    onClick={() => setDialogueLanguage(lang.value)}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="video-dialogue-text" className="mb-2 block text-sm font-medium">
                Dialogue text
              </label>
              <textarea
                id="video-dialogue-text"
                className="min-h-20 w-full resize-y rounded-md border bg-background p-3 text-sm"
                placeholder={
                  dialogueLanguage === "ar"
                    ? "اكتب ما يقوله الشخص..."
                    : "Write what the character says…"
                }
                value={dialogueText}
                onChange={(e) => setDialogueText(e.target.value)}
                dir="auto"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Works best with Veo 3.1 and Kling 2.6. Dialogue is injected into the prompt.
              </p>
            </div>
          </>
        )}

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
          {isRewriting
            ? "Enhancing prompt…"
            : isGenerating
              ? "Generating…"
              : "Generate"}
        </Button>

        <LatestResultsInline mode="video" />
      </div>
    </FormPageLayout>
  );
}
