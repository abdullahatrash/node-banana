"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createText,
  createClip,
  duration,
  type EditorMedia,
  type EditorRecord,
  type MediaRole,
  roles,
  mediaKind,
} from "@/lib/video-editor/composition";
import { createEditorClient, type MediaItem } from "@/lib/video-editor/api";
import { getActiveWorkspaceId } from "@/lib/studio/client";
import { useEditorDraft } from "./useEditorDraft";
import {
  exportComposition,
  type ExportResult,
} from "@/lib/video-editor/export-client";
import { MediaThumbnail } from "./MediaThumbnail";
import { TextControls } from "./TextControls";
import { Preview, type PreviewHandle } from "./Preview";
import { editorCopy, errorCopy } from "./copy";
import styles from "./editor.module.css";

export function VideoEditor({
  locale = "ar",
  initialId,
  initialAsset,
}: {
  locale?: "ar" | "en";
  initialId?: string;
  initialAsset?: string;
}) {
  const copy = editorCopy[locale];
  const api = useMemo(() => createEditorClient(getActiveWorkspaceId()), []);
  const draft = useEditorDraft(api, copy);
  const {
    composition,
    change: setComposition,
    current,
    status,
    error,
    setError,
    records,
    setRecords,
    adopt,
  } = draft;
  const [textSelected, setTextSelected] = useState(false);
  const [selectedRole, setSelectedRole] = useState<MediaRole>("main");
  const [uploadPhase, setUploadPhase] = useState<
    "uploading" | "processing" | null
  >(null);
  const [assets, setAssets] = useState<MediaItem[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [media, setMedia] = useState<Record<string, EditorMedia>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null),
    [resultUrl, setResultUrl] = useState("");
  const outputUrl = useRef(""),
    outputSnapshot = useRef({ key: "", title: "" });
  const controller = useRef<AbortController | null>(null),
    result = useRef<ExportResult | null>(null);
  const preview = useRef<PreviewHandle>(null);
  const open = useCallback(
    async (record: EditorRecord, retainUndo = false) => {
      setBusy(true);
      adopt(record, retainUndo);
      const items = [
        ...new Set(
          roles.flatMap((role) => record.composition[role]?.assetId || []),
        ),
      ];
      const resolved = await Promise.allSettled(
        items.map((id) => api.resolveAsset(id)),
      );
      setMedia((existing) => ({
        ...(retainUndo ? existing : {}),
        ...Object.fromEntries(
          resolved.flatMap((item) =>
            item.status === "fulfilled" ? [[item.value.id, item.value]] : [],
          ),
        ),
      }));
      setBusy(false);
      if (resolved.some((item) => item.status === "rejected"))
        setError(copy.errors.EDITOR_MEDIA_UNAVAILABLE);
    },
    [api, adopt, setError, copy],
  );
  useEffect(() => {
    let active = true;
    setBusy(true);
    void Promise.all([api.listMedia(), api.loadRecords(initialId)])
      .then(async ([library, drafts]) => {
        if (!active) return;
        setAssets(library.items);
        setCursor(library.nextCursor);
        setRecords(drafts);
        const record = drafts.find((item) => item.id === initialId);
        if (record) await open(record);
        else if (initialId) setError(copy.errors.EDITOR_NOT_FOUND);
        else if (initialAsset) {
          const item = await api.resolveAsset(initialAsset);
          if (
            item.type !== "video" ||
            Math.max(item.width, item.height) > 1920 ||
            Math.min(item.width, item.height) > 1080
          )
            throw new Error("EDITOR_MEDIA_LIMIT");
          setMedia({ [item.id]: item });
          setComposition((value) => ({
            ...value,
            main: createClip(item.id, item.duration),
          }));
        }
      })
      .catch((failure) => {
        if (active) setError(errorCopy(failure, copy));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [
    initialId,
    initialAsset,
    api,
    copy,
    open,
    setError,
    setRecords,
    setComposition,
  ]);
  useEffect(
    () => () => {
      controller.current?.abort();
      if (outputUrl.current) URL.revokeObjectURL(outputUrl.current);
      void result.current?.release().catch(() => undefined);
    },
    [],
  );
  async function select(item: MediaItem) {
    setBusy(true);
    setError("");
    try {
      const selected = await api.resolveMedia(item);
      if (
        selected.duration <= 0 ||
        (selected.type === "video" &&
          (Math.max(selected.width, selected.height) > 1920 ||
            Math.min(selected.width, selected.height) > 1080))
      )
        throw new Error("EDITOR_MEDIA_LIMIT");
      setMedia((items) => ({ ...items, [item.id]: selected }));
      setComposition((value) => ({
        ...value,
        [selectedRole]: {
          ...createClip(item.id, selected.duration),
          trimEnd: Math.min(
            selected.duration,
            selectedRole === "main"
              ? 60
              : Math.min(
                  selectedRole === "secondary" ? 15 : 60,
                  duration(value),
                ),
          ),
        },
      }));
    } catch (failure) {
      setError(errorCopy(failure, copy));
    } finally {
      setBusy(false);
    }
  }
  async function runExport() {
    preview.current?.pause();
    setError("");
    setProgress(0);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl("");
    await result.current?.release().catch(() => undefined);
    result.current = null;
    const abort = new AbortController();
    controller.current = abort;
    try {
      const refreshed = await Promise.all(
        [
          ...new Set(roles.flatMap((role) => composition[role]?.assetId || [])),
        ].map(async (id) => {
          const item = media[id];
          if (!item) throw new Error("EDITOR_MEDIA_UNAVAILABLE");
          const { downloadUrl } = await api.request(
            `/api/studio/assets/${encodeURIComponent(id)}/download`,
            undefined,
            "GET",
            abort.signal,
          );
          return { ...item, url: downloadUrl };
        }),
      );
      result.current = await exportComposition(
        composition,
        Object.fromEntries(refreshed.map((item) => [item.id, item])),
        { signal: abort.signal, onProgress: setProgress },
      );
      outputSnapshot.current = {
        key: JSON.stringify(composition),
        title: composition.title,
      };
      outputUrl.current = URL.createObjectURL(result.current.file);
      setResultUrl(outputUrl.current);
    } catch (failure) {
      if (!abort.signal.aborted) setError(errorCopy(failure, copy));
    } finally {
      setProgress(null);
      controller.current = null;
    }
  }
  return (
    <main
      className={styles.editor}
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <header className={styles.header}>
        <Link href="/simple-studio/videos">{copy.back}</Link>
        <h1>{copy.title}</h1>
        <input
          disabled={busy}
          aria-label={copy.name}
          value={composition.title}
          maxLength={240}
          onChange={(e) =>
            setComposition({ ...composition, title: e.target.value })
          }
        />
        <button onClick={draft.undo} disabled={!draft.canUndo}>
          {copy.undo}
        </button>
        <button onClick={draft.redo} disabled={!draft.canRedo}>
          {copy.redo}
        </button>
        <span role="status">{status}</span>
        <span dir="ltr">1080p · 9:16</span>
        <button
          disabled={busy || !composition.main || status === copy.saving}
          onClick={() => void draft.save()}
        >
          {copy.save}
        </button>
        <button
          className={styles.primary}
          disabled={!composition.main || progress !== null || busy}
          onClick={() => void runExport()}
        >
          {copy.export}
        </button>
      </header>
      {(error || draft.conflict) && (
        <div className={styles.error} role="alert">
          {error || copy.errors.EDITOR_SAVE_CONFLICT}
          {draft.conflict && (
            <>
              <button onClick={() => void draft.saveCopy()}>
                {copy.saveCopy}
              </button>
              <button
                onClick={() =>
                  void api
                    .loadRecords(current?.id)
                    .then((items) => {
                      const record = items.find(
                        (item) => item.id === current?.id,
                      );
                      if (record) return open(record, true);
                      throw new Error("EDITOR_NOT_FOUND");
                    })
                    .catch((failure) => setError(errorCopy(failure, copy)))
                }
              >
                {copy.reloadSaved}
              </button>
            </>
          )}
        </div>
      )}
      <fieldset disabled={busy} className={styles.workspace} dir="ltr">
        <aside className={styles.panel} dir={locale === "ar" ? "rtl" : "ltr"}>
          <h2>{copy.media}</h2>
          <p>{copy.limits}</p>
          <button
            onClick={() => {
              setComposition({
                ...composition,
                text: composition.text || createText(),
              });
              setTextSelected(true);
            }}
          >
            {copy.addText}
          </button>
          <label>
            {copy.addTo}
            <select
              value={selectedRole}
              onChange={(event) => {
                setSelectedRole(event.target.value as MediaRole);
                setTextSelected(false);
              }}
            >
              {roles.map((role) => (
                <option
                  key={role}
                  value={role}
                  disabled={role !== "main" && !composition.main}
                >
                  {copy[role]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.upload}
            <input
              type="file"
              accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/x-wav"
              disabled={Boolean(uploadPhase)}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setError("");
                void api
                  .uploadMedia(file, setUploadPhase)
                  .then((item) => {
                    setAssets((items) => [
                      item,
                      ...items.filter((value) => value.id !== item.id),
                    ]);
                  })
                  .catch((failure) => setError(errorCopy(failure, copy)))
                  .finally(() => setUploadPhase(null));
              }}
            />
          </label>
          {uploadPhase && <p role="status">{copy[uploadPhase]}</p>}
          <select
            aria-label={copy.open}
            disabled={busy}
            value={current?.id || ""}
            onChange={(e) => {
              const record = records.find((item) => item.id === e.target.value);
              if (record)
                void draft
                  .save()
                  .then((saved) => {
                    if (saved) return open(record);
                  })
                  .catch((failure) => setError(errorCopy(failure, copy)));
            }}
          >
            <option value="">{copy.open}</option>
            {records.map((record) => (
              <option key={record.id} value={record.id}>
                {record.composition.title}
              </option>
            ))}
          </select>
          {assets
            .filter((item) => item.type === "video" || item.type === "audio")
            .map((item) => (
              <button
                className={styles.mediaCard}
                key={item.id}
                disabled={busy || item.type !== mediaKind(selectedRole)}
                onClick={() => void select(item)}
              >
                {item.type === "video" && (
                  <MediaThumbnail id={item.id} api={api} />
                )}
                <span>{item.name}</span>
                <small>{item.durationSeconds}s</small>
              </button>
            ))}
          {!assets.length && <p>{copy.empty}</p>}
          {cursor && (
            <button
              onClick={() =>
                void api
                  .listMedia(cursor)
                  .then((page) => {
                    setAssets([...assets, ...page.items]);
                    setCursor(page.nextCursor);
                  })
                  .catch((failure) => setError(errorCopy(failure, copy)))
              }
            >
              {copy.more}
            </button>
          )}
        </aside>
        <Preview
          ref={preview}
          composition={composition}
          media={media}
          copy={copy}
          onChange={setComposition}
          onSelectText={() => setTextSelected(true)}
        />
        <aside className={styles.panel} dir={locale === "ar" ? "rtl" : "ltr"}>
          <h2>{!textSelected && copy[selectedRole]}</h2>
          {textSelected && composition.text && (
            <TextControls
              value={composition.text}
              copy={copy}
              onChange={(text) => setComposition({ ...composition, text })}
            />
          )}
          {!textSelected && mediaKind(selectedRole) === "audio" && (
            <button disabled>{copy.generateLater}</button>
          )}
          {!textSelected && composition[selectedRole] && (
            <>
              {(
                [
                  "trimStart",
                  "trimEnd",
                  ...(selectedRole === "main" ? [] : ["start"]),
                ] as ("trimStart" | "trimEnd" | "start")[]
              ).map((field) => (
                <label key={field}>
                  {field === "trimStart"
                    ? copy.start
                    : field === "trimEnd"
                      ? copy.end
                      : copy.position}
                  <input
                    type="number"
                    step={1 / 30}
                    min={0}
                    max={
                      field === "start"
                        ? duration(composition)
                        : media[composition[selectedRole]!.assetId]?.duration ||
                          60
                    }
                    value={composition[selectedRole]![field]}
                    onChange={(e) =>
                      setComposition({
                        ...composition,
                        [selectedRole]: {
                          ...composition[selectedRole]!,
                          [field]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
              <label>
                {copy.gain}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={composition[selectedRole]!.gain}
                  onChange={(event) =>
                    setComposition({
                      ...composition,
                      [selectedRole]: {
                        ...composition[selectedRole]!,
                        gain: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label>
                <span>
                  {copy.muted} · {copy[selectedRole]}
                </span>
                <input
                  type="checkbox"
                  checked={composition[selectedRole]!.muted}
                  onChange={(event) =>
                    setComposition({
                      ...composition,
                      [selectedRole]: {
                        ...composition[selectedRole]!,
                        muted: event.target.checked,
                      },
                    })
                  }
                />
              </label>
              {selectedRole !== "main" && (
                <button
                  onClick={() =>
                    setComposition({ ...composition, [selectedRole]: null })
                  }
                >
                  {copy.remove}
                </button>
              )}
            </>
          )}
        </aside>
      </fieldset>
      <section className={styles.timeline} dir="ltr">
        {roles.map((role) => (
          <div key={role} className={styles.track}>
            <button
              onClick={() => {
                setSelectedRole(role);
                setTextSelected(false);
              }}
            >
              {copy[role]}
            </button>
            <div className={styles.trackLane}>
              {composition[role] && (
                <button
                  className={styles.clip}
                  onClick={() => {
                    setSelectedRole(role);
                    setTextSelected(false);
                  }}
                  style={{
                    marginLeft: `${(100 * composition[role]!.start) / (duration(composition) || 1)}%`,
                    width: `${(100 * (composition[role]!.trimEnd - composition[role]!.trimStart)) / (duration(composition) || 1)}%`,
                  }}
                >
                  {mediaKind(role) === "video" && (
                    <MediaThumbnail id={composition[role]!.assetId} api={api} />
                  )}
                  {media[composition[role]!.assetId]?.name}
                </button>
              )}
            </div>
          </div>
        ))}
      </section>
      {progress !== null && (
        <section role="status" className={styles.exportStatus}>
          {copy.exporting}
          <progress max={100} value={progress} />
          <button onClick={() => controller.current?.abort()}>
            {copy.cancel}
          </button>
        </section>
      )}
      {resultUrl && (
        <a
          className={styles.download}
          download={`${outputSnapshot.current.title}.mp4`}
          href={resultUrl}
        >
          {outputSnapshot.current.key === JSON.stringify(composition)
            ? copy.download
            : copy.previousExport}
        </a>
      )}
    </main>
  );
}
