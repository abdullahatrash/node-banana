'use client';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { clipActive, duration, roles, videoRects, type Composition, type EditorMedia, type MediaRole } from '@/lib/video-editor/composition';
import type { EditorCopy } from './copy';
import styles from './editor.module.css';
export interface PreviewHandle { pause(): void; seek(time: number): void }
export const Preview = forwardRef<PreviewHandle, { composition: Composition; media: Record<string, EditorMedia>; copy: EditorCopy }>(function Preview({ composition, media, copy }, ref) {
 const elements = useRef<Partial<Record<MediaRole, HTMLMediaElement>>>({});
 const [playing, setPlaying] = useState(false), [time, setTime] = useState(0);
 const clock = useRef(0), latest = useRef(composition); latest.current = composition;
 const pause = useCallback(() => { Object.values(elements.current).forEach(element => element.pause()); setPlaying(false); }, []);
 const sync = useCallback((value: number, play: boolean, force = false) => {
  const composition = latest.current;
  for (const role of roles) {
   const clip = composition[role], element = elements.current[role]; if (!clip || !element) continue;
   const active = clipActive(clip, value), position = clip.trimStart + Math.max(0, Math.min(value - clip.start, clip.trimEnd - clip.trimStart));
   if (force || Math.abs(element.currentTime - position) > 0.1) element.currentTime = position;
   element.volume = clip.gain; element.muted = clip.muted;
   if (active && play) { if (element.paused) void element.play().catch(pause); } else element.pause();
  }
  clock.current = value; setTime(value);
 }, [pause]);
 const seek = useCallback((value: number) => sync(value, playing, true), [sync, playing]);
 useImperativeHandle(ref, () => ({ pause, seek }), [pause, seek]);
 const main = composition.main, seconds = duration(composition);
 useEffect(() => { pause(); sync(0, false, true); }, [main?.assetId, main?.trimStart, main?.trimEnd, pause, sync]);
 useEffect(() => { sync(clock.current, playing, true); }, [composition, playing, sync]);
 useEffect(() => {
  if (!playing) return;
  let id: number;
  const tick = () => {
   const next = Math.max(0, (elements.current.main?.currentTime || 0) - (latest.current.main?.trimStart || 0));
   if (next >= duration(latest.current)) { pause(); sync(duration(latest.current), false, true); return; }
   sync(next, true); id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick); return () => cancelAnimationFrame(id);
 }, [playing, pause, sync]);
 const rectangles = videoRects(composition.layout, clipActive(composition.secondary, time));
 return <section className={styles.stage}>
  <div className={styles.canvas}>
   {(['main', 'secondary'] as const).map(role => {
    const clip = composition[role], source = clip ? media[clip.assetId] : null, rect = rectangles[role];
    return source && <video key={role} aria-label={copy[role]} ref={element => { if (element) elements.current[role] = element; else delete elements.current[role]; }} src={source.url} preload="metadata" playsInline crossOrigin="anonymous" onLoadedMetadata={() => sync(clock.current, playing, true)} onEnded={role === 'main' ? pause : undefined} style={{ display: rect ? 'block' : 'none', left: `${(rect?.x || 0) * 100}%`, top: `${(rect?.y || 0) * 100}%`, width: `${(rect?.width || 1) * 100}%`, height: `${(rect?.height || 1) * 100}%` }} />;
   })}
   {!main && <p>{copy.select}</p>}
  </div>
  <div className={styles.transport} dir="ltr">
   <button disabled={!main} aria-label={playing ? copy.pause : copy.play} onClick={() => { if (playing) pause(); else { sync(time >= seconds ? 0 : time, true, true); setPlaying(true); } }}>{playing ? 'Ⅱ' : '▶'}</button>
   <output>{time.toFixed(1)} / {seconds.toFixed(1)}</output>
   <input aria-label={copy.seek} type="range" min={0} max={seconds || 1} step={1 / 30} value={time} onChange={event => seek(Number(event.target.value))} />
  </div>
 </section>;
});
