"use client";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  clipActive,
  sourceTime,
  clipSegments,
  duration,
  roles,
  videoRects,
  type Composition,
  type EditorMedia,
  type MediaRole,
} from "@/lib/video-editor/composition";
import type { EditorCopy } from "./copy";
import { TextOverlay } from "./TextOverlay";
import styles from "./editor.module.css";
export interface PreviewHandle {
  pause(): void;
  seek(time: number): void;
  time(): number;
}
export const Preview = forwardRef<
  PreviewHandle,
  {
    composition: Composition;
    media: Record<string, EditorMedia>;
    copy: EditorCopy;
    onChange(value: Composition): void;
    onSelectText(): void;
    onTime?(time: number): void;
  }
>(function Preview(
  { composition, media, copy, onChange, onSelectText, onTime },
  ref,
) {
  const elements = useRef<Partial<Record<MediaRole, HTMLMediaElement>>>({});
  const previewArea = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const area = previewArea.current;
    if (!area) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.min(
        entry.contentRect.width,
        (entry.contentRect.height * 9) / 16,
      );
      setCanvasSize({ width, height: (width * 16) / 9 });
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, []);
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0);
  const lastSection = useRef<Partial<Record<MediaRole, number>>>({});
  const clock = useRef(0),
    latest = useRef(composition);
  latest.current = composition;
  const pause = useCallback(() => {
    Object.values(elements.current).forEach((element) => element.pause());
    setPlaying(false);
  }, []);
  const sync = useCallback(
    (value: number, play: boolean, force = false) => {
      const composition = latest.current;
      for (const role of roles) {
        const clip = composition[role],
          element = elements.current[role];
        if (!clip || !element) continue;
        const active = clipActive(clip, value),
          position = sourceTime(clip, value);
        const segments = clipSegments(clip);
        let remaining = value - clip.start;
        let index = 0;
        while (
          index < segments.length - 1 &&
          remaining >=
            segments[index].trimEnd - segments[index].trimStart - 1e-9
        ) {
          remaining -= segments[index].trimEnd - segments[index].trimStart;
          index++;
        }
        const previous = lastSection.current[role];
        const crossedCut =
          previous !== undefined &&
          previous !== index &&
          Math.abs(
            segments[index].trimStart - (segments[previous]?.trimEnd ?? -1),
          ) > 1e-6;
        lastSection.current[role] = index;
        if (
          force ||
          crossedCut ||
          Math.abs(element.currentTime - position) > 0.1
        )
          element.currentTime = position;
        element.volume = clip.gain;
        element.muted = clip.muted;
        if (active && play) {
          if (element.paused) void element.play().catch(pause);
        } else element.pause();
      }
      clock.current = value;
      setTime(value);
      onTime?.(value);
    },
    [pause, onTime],
  );
  const seek = useCallback(
    (value: number) =>
      sync(
        Math.max(0, Math.min(duration(latest.current), value)),
        playing,
        true,
      ),
    [sync, playing],
  );
  useImperativeHandle(ref, () => ({ pause, seek, time: () => clock.current }), [
    pause,
    seek,
  ]);
  const main = composition.main,
    seconds = duration(composition);
  useEffect(() => {
    pause();
    sync(0, false, true);
  }, [main?.assetId, pause, sync]);
  useEffect(() => {
    sync(Math.min(clock.current, duration(composition)), playing, true);
  }, [composition, playing, sync]);
  useEffect(() => {
    if (!playing) return;
    let id: number;
    let previous = performance.now();
    const tick = () => {
      const now = performance.now(),
        main = elements.current.main;
      // Freeze the composition clock while the decoder seeks across a cut.
      const next =
        clock.current +
        (main && !main.seeking && main.readyState >= 2
          ? (now - previous) / 1000
          : 0);
      previous = now;
      if (next >= duration(latest.current)) {
        pause();
        sync(duration(latest.current), false, true);
        return;
      }
      sync(next, true);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, pause, sync]);
  const rectangles = videoRects(
    composition.layout,
    clipActive(composition.secondary, time),
  );
  return (
    <section className={styles.stage}>
      <div className={styles.presets}>
        {(["stacked", "pip", "side-by-side"] as const).map((layout) => (
          <button
            key={layout}
            aria-pressed={composition.layout === layout}
            onClick={() => onChange({ ...composition, layout })}
          >
            {copy.layouts[layout]}
          </button>
        ))}
      </div>
      <div ref={previewArea} className={styles.previewArea}>
        <div className={styles.canvas} style={canvasSize}>
          {(["main", "secondary"] as const).map((role) => {
            const clip = composition[role],
              source = clip ? media[clip.assetId] : null,
              rect = rectangles[role];
            return (
              source && (
                <video
                  key={role}
                  aria-label={copy[role]}
                  ref={(element) => {
                    if (element) elements.current[role] = element;
                    else delete elements.current[role];
                  }}
                  src={source.url}
                  preload="metadata"
                  playsInline
                  crossOrigin="anonymous"
                  onLoadedMetadata={() => sync(clock.current, playing, true)}
                  onEnded={role === "main" ? pause : undefined}
                  style={{
                    display: rect ? "block" : "none",
                    left: `${(rect?.x || 0) * 100}%`,
                    top: `${(rect?.y || 0) * 100}%`,
                    width: `${(rect?.width || 1) * 100}%`,
                    height: `${(rect?.height || 1) * 100}%`,
                  }}
                />
              )
            );
          })}
          {composition.text && (
            <TextOverlay
              value={composition.text}
              copy={copy}
              onSelect={onSelectText}
              onChange={(text) => onChange({ ...composition, text })}
            />
          )}
          {!main && <p>{copy.select}</p>}
        </div>
      </div>
      {(["music", "voiceover"] as const).map((role) => {
        const clip = composition[role];
        return (
          clip &&
          media[clip.assetId] && (
            <audio
              key={role}
              aria-label={copy[role]}
              ref={(element) => {
                if (element) elements.current[role] = element;
                else delete elements.current[role];
              }}
              src={media[clip.assetId].url}
              preload="metadata"
              crossOrigin="anonymous"
              onLoadedMetadata={() => sync(clock.current, playing, true)}
            />
          )
        );
      })}
      <div className={styles.transport} dir="ltr">
        <button
          disabled={!main}
          aria-label={playing ? copy.pause : copy.play}
          onClick={() => {
            if (playing) pause();
            else {
              sync(time >= seconds ? 0 : time, true, true);
              setPlaying(true);
            }
          }}
        >
          {playing ? "Ⅱ" : "▶"}
        </button>
        <output>
          {time.toFixed(1)} / {seconds.toFixed(1)}
        </output>
        <input
          aria-label={copy.seek}
          type="range"
          min={0}
          max={seconds || 1}
          step={1 / 30}
          value={time}
          onChange={(event) => seek(Number(event.target.value))}
        />
      </div>
    </section>
  );
});
