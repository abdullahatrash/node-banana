'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { duration, type Composition, type EditorMedia } from '@/lib/video-editor/composition';
import type { EditorCopy } from './copy';
import styles from './editor.module.css';
export interface PreviewHandle { pause(): void; seek(time: number): void }
export const Preview = forwardRef<PreviewHandle, { composition: Composition; media: Record<string, EditorMedia>; copy: EditorCopy }>(function Preview({ composition, media, copy }, ref) {
 const video = useRef<HTMLVideoElement>(null);
 const [playing, setPlaying] = useState(false);
 const [time, setTime] = useState(0);
 const seconds = duration(composition), clip = composition.main;
 const source = clip ? media[clip.assetId] : null;
 function pause() { video.current?.pause(); setPlaying(false); }
 function seek(value: number) { if (video.current && clip) video.current.currentTime = clip.trimStart + value; setTime(value); }
 useImperativeHandle(ref, () => ({ pause, seek }));
 useEffect(() => { pause(); seek(0); }, [clip?.assetId, clip?.trimStart, clip?.trimEnd]); // playback state stays inside the preview
 return <section className={styles.stage}>
  <div className={styles.canvas}>
   {source ? <video ref={video} src={source.url} preload="metadata" playsInline crossOrigin="anonymous" onLoadedMetadata={() => seek(0)} onTimeUpdate={() => { const next = (video.current?.currentTime || 0) - (clip?.trimStart || 0); if (next >= seconds) { pause(); seek(seconds); } else setTime(Math.max(0, next)); }} onEnded={pause} /> : <p>{copy.select}</p>}
  </div>
  <div className={styles.transport} dir="ltr">
   <button disabled={!source} aria-label={playing ? copy.pause : copy.play} onClick={() => { if (playing) pause(); else { if (time >= seconds) seek(0); void video.current?.play().then(() => setPlaying(true)).catch(pause); } }}>{playing ? 'Ⅱ' : '▶'}</button>
   <output>{time.toFixed(1)} / {seconds.toFixed(1)}</output>
   <input aria-label={copy.seek} type="range" min={0} max={seconds || 1} step={1 / 30} value={time} onChange={(event) => seek(Number(event.target.value))} />
  </div>
 </section>;
});
