"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { supportedVideoDurations } from "@/lib/model-routing/video-duration";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";

export function VideoDurationControl({
  className,
  inverse = false,
}: {
  className?: string;
  inverse?: boolean;
}) {
  const t = useTranslations("simpleStudio.forms");
  const videoDuration = useSimpleStudioStore((state) => state.videoDuration);
  const maxQuantity = useSimpleStudioStore(
    (state) => state.selectedModelMaxQuantity,
  );
  const setVideoDuration = useSimpleStudioStore(
    (state) => state.setVideoDuration,
  );
  const durations = supportedVideoDurations(maxQuantity);

  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="mb-2 text-sm font-medium">{t("video.duration")}</legend>
      <div className="flex flex-wrap gap-2" dir="ltr">
        {durations.map((duration) => {
          const selected = videoDuration === duration;
          return (
            <button
              key={duration}
              type="button"
              aria-pressed={selected}
              className={cn(
                "rounded-md border px-3 py-1 text-xs",
                inverse
                  ? selected
                    ? "border-amber-300 bg-amber-300/15 text-amber-100"
                    : "border-white/20 text-white hover:bg-white/10"
                  : selected
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted",
              )}
              onClick={() => setVideoDuration(duration)}
            >
              {t("video.durationValue", { seconds: duration })}
            </button>
          );
        })}
      </div>
      <p
        className={cn(
          "mt-1 text-[11px]",
          inverse ? "text-stone-400" : "text-muted-foreground",
        )}
      >
        {t("video.durationHint")}
      </p>
    </fieldset>
  );
}
