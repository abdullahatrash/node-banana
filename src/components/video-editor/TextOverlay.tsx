"use client";
import { useEffect, useRef, useState } from "react";
import { overlayLayout, paintOverlay } from "@/lib/video-editor/overlay";
import type { TextOverlay as TextValue } from "@/lib/video-editor/composition";
import type { EditorCopy } from "./copy";
import styles from "./editor.module.css";
export function TextOverlay({
  value,
  onChange,
  onSelect,
  copy,
}: {
  value: TextValue;
  onChange(value: TextValue): void;
  onSelect(): void;
  copy: EditorCopy;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    box = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false),
    [scale, setScale] = useState(0.25);
  const [layout, setLayout] = useState({
    x: 540,
    y: 1500,
    width: 800,
    height: 170,
  });
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    initialX: number;
    initialY: number;
  } | null>(null);
  useEffect(() => {
    const parent = box.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() =>
      setScale(parent.clientWidth / 1080),
    );
    observer.observe(parent);
    setScale(parent.clientWidth / 1080);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    const draw = () => {
      if (!active || !canvas.current) return;
      const context = canvas.current.getContext("2d");
      if (!context) return;
      const next = overlayLayout(context, value);
      canvas.current.width = next.width;
      canvas.current.height = next.height;
      paintOverlay(context, next);
      setLayout(next);
    };
    draw();
    void document.fonts
      ?.load(`${value.fontWeight} ${value.fontSize}px EditorArabic`)
      .then(draw)
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [value]);
  const move = (x: number, y: number) =>
    onChange({
      ...value,
      x: Math.max(layout.width / 2160, Math.min(1 - layout.width / 2160, x)),
      y: Math.max(layout.height / 3840, Math.min(1 - layout.height / 3840, y)),
    });
  return (
    <div
      ref={box}
      className={styles.textOverlay}
      role="button"
      tabIndex={0}
      aria-label={copy.moveText}
      style={{
        left: `${(100 * layout.x) / 1080}%`,
        top: `${(100 * layout.y) / 1920}%`,
        width: layout.width * scale,
        height: layout.height * scale,
      }}
      onFocus={onSelect}
      onClick={onSelect}
      onDoubleClick={() => setEditing(true)}
      onPointerDown={(event) => {
        if (editing) return;
        onSelect();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointer: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          initialX: layout.x / 1080,
          initialY: layout.y / 1920,
        };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || editing) return;
        move(
          start.initialX + (event.clientX - start.x) / (scale * 1080),
          start.initialY + (event.clientY - start.y) / (scale * 1920),
        );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (editing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          setEditing(true);
          return;
        }
        const delta = event.shiftKey ? 20 : 4;
        const dx =
          event.key === "ArrowLeft"
            ? -delta
            : event.key === "ArrowRight"
              ? delta
              : 0;
        const dy =
          event.key === "ArrowUp"
            ? -delta
            : event.key === "ArrowDown"
              ? delta
              : 0;
        if (dx || dy) {
          event.preventDefault();
          move(layout.x / 1080 + dx / 1080, layout.y / 1920 + dy / 1920);
        }
      }}
    >
      <canvas
        ref={canvas}
        aria-hidden="true"
        style={{
          visibility: editing ? "hidden" : "visible",
          width: "100%",
          height: "100%",
        }}
      />
      {editing && (
        <textarea
          autoFocus
          aria-label={copy.inlineText}
          dir="auto"
          maxLength={1000}
          value={value.text}
          style={{
            fontSize: value.fontSize * scale,
            fontWeight: value.fontWeight,
            textAlign: value.align,
            color: value.color,
          }}
          onChange={(event) => onChange({ ...value, text: event.target.value })}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              setEditing(false);
              box.current?.focus();
            }
            event.stopPropagation();
          }}
        />
      )}
    </div>
  );
}
