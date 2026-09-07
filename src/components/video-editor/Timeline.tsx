"use client";
import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  clipSegments,
  duration,
  mediaKind,
  roles,
  type Composition,
  type Clip,
  type EditorMedia,
  type MediaRole,
} from "@/lib/video-editor/composition";
import {
  deleteSection,
  moveClip,
  sectionStart,
  splitClip,
  trimSection,
} from "@/lib/video-editor/editing";
import type { EditorClient } from "@/lib/video-editor/api";
import { MediaThumbnail } from "./MediaThumbnail";
import type { PreviewHandle } from "./Preview";
import type { EditorCopy } from "./copy";
import styles from "./editor.module.css";

function trimPreviewTime(
  clip: Clip,
  index: number,
  edge: "trimStart" | "trimEnd",
) {
  const segment = clipSegments(clip)[index];
  return (
    sectionStart(clip, index) +
    (edge === "trimEnd"
      ? Math.max(0, segment.trimEnd - segment.trimStart - 1 / 30)
      : 0)
  );
}
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
    onGesture?(active: boolean): void;
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
    onGesture,
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
  const ruler = useRef<HTMLDivElement>(null);
  const scrub = useRef(false);
  const pendingTime = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingTime.current === null) return;
    preview.current?.seek(pendingTime.current);
    pendingTime.current = null;
  }, [composition, preview]);
  const seconds = duration(composition) || 1;
  useImperativeHandle(
    ref,
    () => ({
      showTime(time) {
        if (playhead.current)
          playhead.current.style.left = `${(100 * time) / seconds}%`;
        ruler.current?.setAttribute("aria-valuenow", String(time));
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
    edge: "trimStart" | "trimEnd" | "move";
    offset: number;
  } | null>(null);
  const seekPointer = (clientX: number) => {
    const rect = ruler.current?.getBoundingClientRect();
    if (!rect?.width) return;
    preview.current?.seek(
      Math.round(((clientX - rect.left) / rect.width) * seconds * 30) / 30,
    );
  };
  const beginScrub = (event: PointerEvent<HTMLElement>) => {
    if (busy || event.button !== 0) return;
    event.preventDefault();
    preview.current?.pause();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrub.current = true;
    seekPointer(event.clientX);
  };
  const finishDrag = () => {
    if (drag.current) onGesture?.(false);
    drag.current = null;
    scrub.current = false;
    pendingTime.current = null;
  };
  const showEdit = (next: Composition, time: number, atomic = false) => {
    // The draft skips unchanged edits (e.g. a drag beyond a source boundary).
    // Seek now in that case; otherwise wait for Preview to receive the new ranges.
    if (JSON.stringify(next) === JSON.stringify(composition)) {
      pendingTime.current = null;
      preview.current?.seek(time);
    } else {
      pendingTime.current = time;
      onChange(next, atomic);
    }
  };
  const updateDrag = (event: PointerEvent<HTMLElement>) => {
    if (scrub.current) {
      seekPointer(event.clientX);
      return;
    }
    const initial = drag.current;
    if (!initial || !initial.width) return;
    const value =
      initial.value +
      ((event.clientX - initial.x) / initial.width) * initial.seconds;
    const next =
      initial.edge === "move"
        ? moveClip(initial.composition, initial.role, value)
        : trimSection(
            initial.composition,
            initial.role,
            initial.index,
            initial.edge,
            value,
            media[initial.composition[initial.role]!.assetId]?.duration || 60,
          );
    const clip = next[initial.role]!;
    showEdit(
      next,
      initial.edge === "move"
        ? clip.start + initial.offset
        : trimPreviewTime(clip, initial.index, initial.edge),
    );
  };
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
        <div className={styles.track}>
          <small>{copy.scrub}</small>
          <div
            ref={ruler}
            className={styles.ruler}
            role="slider"
            tabIndex={busy ? -1 : 0}
            aria-label={copy.scrub}
            aria-valuemin={0}
            aria-valuemax={duration(composition)}
            aria-valuenow={0}
            aria-disabled={busy}
            title={copy.scrubHelp}
            onPointerDown={beginScrub}
            onPointerMove={updateDrag}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onLostPointerCapture={finishDrag}
            onKeyDown={(event) => {
              if (
                busy ||
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              preview.current?.pause();
              preview.current?.seek(
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? seconds
                    : (preview.current?.time() || 0) +
                      (event.key === "ArrowLeft" ? -1 : 1) *
                        (event.shiftKey ? 1 : 1 / 30),
              );
            }}
          >
            {[0, 1, 2, 3, 4].map((tick) => (
              <span key={tick}>{((seconds * tick) / 4).toFixed(1)}s</span>
            ))}
          </div>
        </div>
        <div className={styles.playheadLane}>
          <div ref={playhead} className={styles.playhead}>
            <div
              className={styles.playheadGrip}
              aria-hidden="true"
              onPointerDown={beginScrub}
              onPointerMove={updateDrag}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onLostPointerCapture={finishDrag}
            />
          </div>
        </div>
        {roles.map((role) => {
          const clip = composition[role];
          return (
            <div key={role} className={styles.track} data-role={role}>
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
                  beginScrub(event);
                }}
                onPointerMove={updateDrag}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                onLostPointerCapture={finishDrag}
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
                        data-movable={role !== "main"}
                        title={role === "main" ? copy.scrubHelp : copy.moveHelp}
                        onClick={() => onSelect(role, i)}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.stopPropagation();
                          onSelect(role, i);
                          if (role === "main") {
                            beginScrub(event);
                            return;
                          }
                          event.preventDefault();
                          preview.current?.pause();
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                          const rect = ruler.current!.getBoundingClientRect();
                          const offset = Math.max(
                            0,
                            Math.min(
                              ((event.clientX - rect.left) / rect.width) *
                                seconds -
                                clip.start,
                              sectionStart(clip, i) -
                                clip.start +
                                segment.trimEnd -
                                segment.trimStart -
                                1 / 30,
                            ),
                          );
                          preview.current?.seek(clip.start + offset);
                          onGesture?.(true);
                          drag.current = {
                            seconds,
                            x: event.clientX,
                            value: clip.start,
                            width: rect.width,
                            composition,
                            role,
                            index: i,
                            edge: "move",
                            offset,
                          };
                        }}
                        onPointerMove={(event) => {
                          event.stopPropagation();
                          updateDrag(event);
                        }}
                        onPointerUp={finishDrag}
                        onPointerCancel={finishDrag}
                        onLostPointerCapture={finishDrag}
                        onKeyDown={(event) => {
                          if (
                            role === "main" ||
                            !["ArrowLeft", "ArrowRight"].includes(event.key)
                          )
                            return;
                          event.preventDefault();
                          preview.current?.pause();
                          const next = moveClip(
                            composition,
                            role,
                            clip.start +
                              (event.key === "ArrowLeft" ? -1 : 1) *
                                (event.shiftKey ? 1 : 1 / 30),
                          );
                          showEdit(next, sectionStart(next[role]!, i), true);
                        }}
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
                            if (event.button !== 0) return;
                            event.stopPropagation();
                            onGesture?.(true);
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
                              offset: 0,
                            };
                          }}
                          onPointerMove={(event) => {
                            event.stopPropagation();
                            updateDrag(event);
                          }}
                          onPointerUp={finishDrag}
                          onPointerCancel={finishDrag}
                          onLostPointerCapture={finishDrag}
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
                            const next = trimSection(
                              composition,
                              role,
                              i,
                              edge,
                              segment[edge] +
                                sign * (event.shiftKey ? 1 : 1 / 30),
                              media[clip.assetId]?.duration || 60,
                            );
                            showEdit(
                              next,
                              trimPreviewTime(next[role]!, i, edge),
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
