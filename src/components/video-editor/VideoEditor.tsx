'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClip, duration, emptyComposition, type Composition, type EditorMedia, type EditorRecord, type MediaRole, roles } from '@/lib/video-editor/composition';
import { uploadMedia, listMedia, loadRecords, resolveMedia, saveComposition, type MediaItem } from '@/lib/video-editor/api';
import { exportComposition, type ExportResult } from '@/lib/video-editor/export-client';
import { Preview, type PreviewHandle } from './Preview';
import { editorCopy, errorCopy } from './copy';
import styles from './editor.module.css';

export function VideoEditor({ locale = 'ar', initialId }: { locale?: 'ar' | 'en'; initialId?: string }) {
 const copy = editorCopy[locale];
 const [composition, setComposition] = useState<Composition>(() => emptyComposition(copy.untitled));
 const [selectedRole, setSelectedRole] = useState<MediaRole>('main');
 const [uploadPhase, setUploadPhase] = useState<'uploading' | 'processing' | null>(null);
 const [assets, setAssets] = useState<MediaItem[]>([]), [cursor, setCursor] = useState<string | null>(null);
 const [media, setMedia] = useState<Record<string, EditorMedia>>({});
 const [records, setRecords] = useState<EditorRecord[]>([]);
 const [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
 const [progress, setProgress] = useState<number | null>(null), [resultUrl, setResultUrl] = useState('');
 const current = useRef<EditorRecord | null>(null), latest = useRef(composition), saved = useRef(JSON.stringify(composition));
 const queue = useRef(Promise.resolve()), controller = useRef<AbortController | null>(null), result = useRef<ExportResult | null>(null);
 const preview = useRef<PreviewHandle>(null);
 latest.current = composition;
 const open = useCallback(async (record: EditorRecord) => {
  const items = roles.flatMap((role) => record.composition[role]?.assetId || []);
  const resolved = await Promise.all(items.map(async (id) => {
   const { editorRequest } = await import('@/lib/video-editor/api');
   const { asset } = await editorRequest(`/api/studio/assets/${encodeURIComponent(id)}`);
   return resolveMedia({ id, name: asset.metadata?.originalFileName || id, type: asset.type, durationSeconds: asset.durationSeconds, width: asset.width, height: asset.height });
  }));
  setMedia(Object.fromEntries(resolved.map((item) => [item.id, item])));
  current.current = record; saved.current = JSON.stringify(record.composition); setComposition(record.composition); setStatus(copy.saved); setError('');
 }, [copy.saved]);
 useEffect(() => {
  let active = true;
  void Promise.all([listMedia(), loadRecords()]).then(async ([library, drafts]) => {
   if (!active) return; setAssets(library.items); setCursor(library.nextCursor); setRecords(drafts);
   const record = drafts.find((item) => item.id === initialId); if (record) await open(record);
  }).catch((failure) => { if (active) setError(errorCopy(failure, copy)); });
  return () => { active = false; };
 }, [initialId, copy, open]);
 const persist = useCallback(() => {
  const snapshot = latest.current;
  if (!snapshot.main || JSON.stringify(snapshot) === saved.current) return Promise.resolve();
  setStatus(copy.saving);
  const task = queue.current.then(async () => {
   const record = await saveComposition(snapshot, current.current, crypto.randomUUID());
   current.current = record; saved.current = JSON.stringify(snapshot);
   setRecords((items) => [record, ...items.filter((item) => item.id !== record.id)]);
   setStatus(JSON.stringify(latest.current) === saved.current ? copy.saved : copy.unsaved);
   const url = new URL(window.location.href); url.searchParams.set('piece', record.id); window.history.replaceState(null, '', url);
  });
  queue.current = task.catch((failure) => { setStatus(copy.unsaved); setError(errorCopy(failure, copy)); });
  return queue.current;
 }, [copy]);
 useEffect(() => { if (!composition.main || JSON.stringify(composition) === saved.current) return; setStatus(copy.unsaved); const timer = setTimeout(() => void persist(), 1200); return () => clearTimeout(timer); }, [composition, persist, copy.unsaved]);
 useEffect(() => () => { controller.current?.abort(); void result.current?.release(); }, []);
 async function select(item: MediaItem) {
  setBusy(true); setError('');
  try { const selected = await resolveMedia(item); if (selected.duration <= 0 || Math.max(selected.width, selected.height) > 1920 || Math.min(selected.width, selected.height) > 1080) throw new Error('EDITOR_MEDIA_LIMIT'); setMedia((items) => ({ ...items, [item.id]: selected })); setComposition((value) => ({ ...value, [selectedRole]: { ...createClip(item.id, selected.duration), trimEnd: Math.min(selected.duration, selectedRole === 'secondary' ? Math.min(15, duration(value)) : 60) } })); }
  catch (failure) { setError(errorCopy(failure, copy)); } finally { setBusy(false); }
 }
 async function runExport() {
  preview.current?.pause(); setError(''); setProgress(0);
  if (resultUrl) URL.revokeObjectURL(resultUrl); setResultUrl(''); await result.current?.release(); result.current = null;
  const abort = new AbortController(); controller.current = abort;
  try { result.current = await exportComposition(composition, media, { signal: abort.signal, onProgress: setProgress }); setResultUrl(URL.createObjectURL(result.current.file)); }
  catch (failure) { if (!abort.signal.aborted) setError(errorCopy(failure, copy)); }
  finally { setProgress(null); controller.current = null; }
 }
 return <main className={styles.editor} lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
  <header className={styles.header}>
   <a href="/simple-studio/videos">{copy.back}</a><h1>{copy.title}</h1>
   <input aria-label={copy.name} value={composition.title} maxLength={240} onChange={(e) => setComposition({ ...composition, title: e.target.value })} />
   <span role="status">{status}</span><span dir="ltr">1080p · 9:16</span>
   <button disabled={!composition.main || status === copy.saving} onClick={() => { setError(''); void persist(); }}>{copy.save}</button>
   <button className={styles.primary} disabled={!composition.main || progress !== null || busy} onClick={() => void runExport()}>{copy.export}</button>
  </header>
  {error && <div className={styles.error} role="alert">{error}</div>}
  <div className={styles.workspace} dir="ltr">
   <aside className={styles.panel} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
    <h2>{copy.media}</h2>
    <label>{copy.addTo}<select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as MediaRole)}>{roles.map((role) => <option key={role} value={role} disabled={role !== 'main' && !composition.main}>{copy[role]}</option>)}</select></label>
    <label>{copy.upload}<input type="file" accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/x-wav" disabled={Boolean(uploadPhase)} onChange={(event) => {
     const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; setError('');
     void uploadMedia(file, setUploadPhase).then((item) => { setAssets((items) => [item, ...items.filter((value) => value.id !== item.id)]); }).catch((failure) => setError(errorCopy(failure, copy))).finally(() => setUploadPhase(null));
    }} /></label>{uploadPhase && <p role="status">{copy[uploadPhase]}</p>}
    <select aria-label={copy.open} value={current.current?.id || ''} onChange={(e) => { const record = records.find((item) => item.id === e.target.value); if (record) void open(record).catch((failure) => setError(errorCopy(failure, copy))); }}><option value="">{copy.open}</option>{records.map((record) => <option key={record.id} value={record.id}>{record.composition.title}</option>)}</select>
    {assets.filter((item) => item.type === 'video' || item.type === 'audio').map((item) => <button className={styles.mediaCard} key={item.id} disabled={busy || item.type !== 'video'} onClick={() => void select(item)}>{item.name}<small>{item.durationSeconds}s</small></button>)}
    {!assets.length && <p>{copy.empty}</p>}
    {cursor && <button onClick={() => void listMedia(cursor).then((page) => { setAssets([...assets, ...page.items]); setCursor(page.nextCursor); }).catch((failure) => setError(errorCopy(failure, copy)))}>{copy.more}</button>}
   </aside>
   <Preview ref={preview} composition={composition} media={media} copy={copy} onChange={setComposition} />
   <aside className={styles.panel} dir={locale === 'ar' ? 'rtl' : 'ltr'}><h2>{copy[selectedRole]}</h2>
    {composition[selectedRole] && <>{(['trimStart', 'trimEnd', ...(selectedRole === 'main' ? [] : ['start'])] as ('trimStart' | 'trimEnd' | 'start')[]).map((field) => <label key={field}>{field === 'trimStart' ? copy.start : field === 'trimEnd' ? copy.end : copy.position}<input type="number" step={1 / 30} min={0} max={field === 'start' ? duration(composition) : media[composition[selectedRole]!.assetId]?.duration || 60} value={composition[selectedRole]![field]} onChange={(e) => setComposition({ ...composition, [selectedRole]: { ...composition[selectedRole]!, [field]: Number(e.target.value) } })} /></label>)}
     {selectedRole !== 'main' && <button onClick={() => setComposition({ ...composition, [selectedRole]: null })}>{copy.remove}</button>}
    </>}
   </aside>
  </div>
  <section className={styles.timeline} dir="ltr">{roles.map((role) => <div key={role} className={styles.track}><button onClick={() => setSelectedRole(role)}>{copy[role]}</button><div className={styles.trackLane}>{composition[role] && <button className={styles.clip} onClick={() => setSelectedRole(role)} style={{ marginLeft: `${100 * composition[role]!.start / (duration(composition) || 1)}%`, width: `${100 * (composition[role]!.trimEnd - composition[role]!.trimStart) / (duration(composition) || 1)}%` }}>{media[composition[role]!.assetId]?.name}</button>}</div></div>)}</section>
  {progress !== null && <section role="status" className={styles.exportStatus}>{copy.exporting}<progress max={100} value={progress} /><button onClick={() => controller.current?.abort()}>{copy.cancel}</button></section>}
  {resultUrl && <a className={styles.download} download={`${composition.title}.mp4`} href={resultUrl}>{copy.download}</a>}
 </main>;
}
