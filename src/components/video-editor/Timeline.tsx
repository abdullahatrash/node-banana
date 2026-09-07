"use client";
import { forwardRef, useImperativeHandle, useRef, type RefObject } from "react";
import {
  clipSegments,
  duration,
  mediaKind,
  roles,
  type Composition,
  type EditorMedia,
  type MediaRole,
} from "@/lib/video-editor/composition";
import {
  deleteSection,
  sectionStart,
  splitClip,
  trimSection,
} from "@/lib/video-editor/editing";
import type { EditorClient } from "@/lib/video-editor/api";
import { MediaThumbnail } from "./MediaThumbnail";
import type { PreviewHandle } from "./Preview";
import type { EditorCopy } from "./copy";
import styles from "./editor.module.css";

export interface TimelineHandle {
  showTime(time: number): void;
}
export const Timeline = forwardRef<
  TimelineHandle,
  {
    composition: Composition;
    selectedRole: MediaRole;
    selectedIndex: number;
    onSelect(role: MediaRole, index: number): void;
    onChange(value: Composition, atomic?: boolean): void;
    onError(message: string): void;
    preview: RefObject<PreviewHandle | null>;
    media: Record<string, EditorMedia>;
    api: EditorClient;
    copy: EditorCopy;
    busy: boolean;
  }
>(function Timeline(
  {
    composition,
    selectedRole,
    selectedIndex,
    onSelect,
    onChange,
    onError,
    preview,
    media,
    api,
    copy,
    busy,
  },
  ref,
) {
  const playhead = useRef<HTMLDivElement>(null),
    timeLabel = useRef<HTMLOutputElement>(null);
  const seconds = duration(composition) || 1;
  useImperativeHandle(
    ref,
    () => ({
      showTime(time) {
        if (playhead.current)
          playhead.current.style.left = `${(100 * time) / seconds}%`;
        if (timeLabel.current)
          timeLabel.current.textContent = `${time.toFixed(2)} / ${duration(composition).toFixed(2)}s`;
      },
    }),
    [seconds, composition],
  );
  const drag = useRef<{
    x: number;
    value: number;
    width: number;
    seconds: number;
    composition: Composition;
    role: MediaRole;
    index: number;
    edge: "trimStart" | "trimEnd";
  } | null>(null);
  const selected = composition[selectedRole];
  const index = selected
    ? Math.min(selectedIndex, clipSegments(selected).length - 1)
    : 0;
  return (
    <section className={styles.timeline} dir="ltr" aria-label={copy.tracks}>
      <div className={styles.timelineTools}>
        <strong>{copy.tracks}</strong>
        <output ref={timeLabel}>
          0.00 / {duration(composition).toFixed(2)}s
        </output>
        <button
          disabled={busy || !selected}
          onClick={() => {
            preview.current?.pause();
            if (!selected) return;
            const next = splitClip(selected, preview.current?.time() || 0);
            if (next === selected) {
              onError(copy.splitHelp);
              return;
            }
            onError("");
            onChange({ ...composition, [selectedRole]: next }, true);
          }}
        >
          {copy.split}
        </button>
        <button
          disabled={
            busy ||
            !selected ||
            (selectedRole === "main" && clipSegments(selected).length === 1)
          }
          onClick={() => {
            preview.current?.pause();
            onChange(deleteSection(composition, selectedRole, index), true);
            onSelect(selectedRole, Math.max(0, index - 1));
          }}
        >
          {copy.deleteSection}
        </button>
        <small>
          {selectedRole === "main" ? copy.rippleHelp : copy.trimHelp}
        </small>
      </div>
      <div className={styles.trackArea}>
        <div className={styles.playheadLane}>
          <div ref={playhead} className={styles.playhead} />
        </div>
        {roles.map((role) => {
          const clip = composition[role];
          return (
            <div key={role} className={styles.track}>
              <button
                aria-pressed={role === selectedRole}
                disabled={busy}
                onClick={() => onSelect(role, 0)}
              >
                {copy[role]}
              </button>
              <div
                className={styles.trackLane}
                onPointerDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  preview.current?.seek(
                    ((event.clientX - rect.left) / rect.width) * seconds,
                  );
                }}
              >
                {clip &&
                  clipSegments(clip).map((segment, i) => (
                    <div
                      key={i}
                      className={styles.clipSection}
                      data-selected={role === selectedRole && i === index}
                      style={{
                        left: `${(100 * sectionStart(clip, i)) / seconds}%`,
                        width: `${(100 * (segment.trimEnd - segment.trimStart)) / seconds}%`,
                      }}
                    >
                      <button
                        className={styles.clip}
                        disabled={busy}
                        aria-label={`${copy[role]} ${copy.section} ${i + 1}`}
                        aria-pressed={role === selectedRole && i === index}
                        onClick={() => onSelect(role, i)}
                      >
                        {mediaKind(role) === "video" && (
                          <MediaThumbnail
                            key={clip.assetId}
                            id={clip.assetId}
                            api={api}
                          />
                        )}
                        <span>
                          {media[clip.assetId]?.name} · {i + 1}
                        </span>
                      </button>
                      {(["trimStart", "trimEnd"] as const).map((edge) => (
                        <button
                          key={edge}
                          className={styles.trimHandle}
                          data-edge={edge}
                          disabled={busy}
                          role="slider"
                          aria-label={`${copy[role]} ${i + 1}: ${edge === "trimStart" ? copy.start : copy.end}`}
                          aria-valuemin={0}
                          aria-valuemax={media[clip.assetId]?.duration || 60}
                          aria-valuenow={segment[edge]}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            preview.current?.pause();
                            onSelect(role, i);
                            event.currentTarget.setPointerCapture(
                              event.pointerId,
                            );
                            drag.current = {
                              seconds,
                              x: event.clientX,
                              value: segment[edge],
                              width:
                                event.currentTarget.parentElement!.parentElement!.getBoundingClientRect()
                                  .width,
                              composition,
                              role,
                              index: i,
                              edge,
                            };
                          }}
                          onPointerMove={(event) => {
                            const initial = drag.current;
                            if (!initial) return;
                            onChange(
                              trimSection(
                                initial.composition,
                                initial.role,
                                initial.index,
                                initial.edge,
                                initial.value +
                                  ((event.clientX - initial.x) /
                                    initial.width) *
                                    initial.seconds,
                                media[clip.assetId]?.duration || 60,
                              ),
                            );
                          }}
                          onPointerUp={() => {
                            drag.current = null;
                          }}
                          onPointerCancel={() => {
                            drag.current = null;
                          }}
                          onKeyDown={(event) => {
                            const sign =
                              event.key === "ArrowLeft"
                                ? -1
                                : event.key === "ArrowRight"
                                  ? 1
                                  : 0;
                            if (!sign) return;
                            event.preventDefault();
                            preview.current?.pause();
                            onSelect(role, i);
                            onChange(
                              trimSection(
                                composition,
                                role,
                                i,
                                edge,
                                segment[edge] +
                                  sign * (event.shiftKey ? 1 : 1 / 30),
                                media[clip.assetId]?.duration || 60,
                              ),
                            );
                          }}
                        >
                          {"‖"}
                        </button>
                      ))}
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
});
