"use client";
/* eslint-disable @next/next/no-img-element -- Tiny worker-produced Blob URLs cannot use the server image optimizer. */
import { useEffect, useRef, useState } from "react";
import type { EditorClient } from "@/lib/video-editor/api";
import styles from "./editor.module.css";
export function MediaThumbnail({ id, api }: { id: string; api: EditorClient }) {
  const element = useRef<HTMLSpanElement>(null),
    [url, setUrl] = useState("");
  useEffect(() => {
    let active = true,
      objectUrl = "",
      requested = false;
    const observer = new IntersectionObserver((entries) => {
      if (requested || !entries.some((entry) => entry.isIntersecting)) return;
      requested = true;
      observer.disconnect();
      void api
        .thumbnail(id)
        .then((blob) => {
          if (active) {
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
          }
        })
        .catch(() => undefined);
    });
    if (element.current) observer.observe(element.current);
    return () => {
      active = false;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, id]);
  return (
    <span ref={element} className={styles.thumbnail} aria-hidden="true">
      {url ? <img src={url} alt="" width={45} height={80} /> : "▶"}
    </span>
  );
}
