/// <reference lib="webworker" />
import { Input, UrlSource, ALL_FORMATS, CanvasSink, CanvasSource, AudioSample, AudioSampleSink, AudioSampleSource, Output, Mp4OutputFormat, StreamTarget, Conversion, WavOutputFormat, BlobSource, canEncodeVideo, canEncodeAudio } from 'mediabunny-editor';
import { overlayLayout, paintOverlay } from './overlay';
import { compositionSchema, duration, clipDuration, clipActive, roles, videoRects, VIDEO_FPS, type EditorMedia, type Clip, type Rect } from './composition';
const scope = self as unknown as DedicatedWorkerGlobalScope;
let cancelled = false;
let conversion: Conversion | null = null;
const rate = 48000, fps = VIDEO_FPS, block = rate / fps;
function checkCancelled() { if (cancelled) throw new Error('EDITOR_CANCELLED'); }
type AudioCursor = { role: string; clip: Clip; offset: number; samples: ReturnType<AudioSampleSink['samples']>; done: boolean; current: { pcm: Float32Array; channels: number; frames: number; start: number; end: number } | null };
async function mix(cursor: AudioCursor, pcm: Float32Array, start: number) {
 for (let j = 0; j < block; j++) {
  const compositionTime = start + j / rate;
  if (!clipActive(cursor.clip, compositionTime)) continue;
  const time = cursor.offset + compositionTime - cursor.clip.start;
  while (!cursor.done && (!cursor.current || time >= cursor.current.end - 1e-9)) {
   const item = await cursor.samples.next(); cursor.done = Boolean(item.done);
   if (item.done) { cursor.current = null; break; }
   const sample = item.value;
   try {
    if (sample.sampleRate !== rate || sample.numberOfChannels > 2) throw new Error('EDITOR_MEDIA_UNAVAILABLE');
    const values = new Float32Array(sample.numberOfFrames * sample.numberOfChannels); sample.copyTo(values, { planeIndex: 0, format: 'f32' });
    cursor.current = { pcm: values, channels: sample.numberOfChannels, frames: sample.numberOfFrames, start: sample.timestamp, end: sample.timestamp + sample.duration };
   } finally { sample.close(); }
  }
  const current = cursor.current;
  if (!current || time < current.start) continue;
  const index = Math.min(current.frames - 1, Math.max(0, Math.floor((time - current.start) * rate + 1e-6)));
  pcm[j * 2] += current.pcm[index * current.channels] * cursor.clip.gain;
  pcm[j * 2 + 1] += current.pcm[index * current.channels + (current.channels === 2 ? 1 : 0)] * cursor.clip.gain;
 }
}
function draw(context: OffscreenCanvasRenderingContext2D, canvas: OffscreenCanvas | HTMLCanvasElement, rect: Rect) {
 const width = rect.width * 1080, height = rect.height * 1920, scale = Math.max(width / canvas.width, height / canvas.height), sw = width / scale, sh = height / scale;
 context.drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh, rect.x * 1080, rect.y * 1920, width, height);
}
scope.onmessage = async ({ data }) => {
 if (data.type === 'cancel') { cancelled = true; await conversion?.cancel().catch(() => undefined); return; }
 if (data.type !== 'export') return;
 cancelled = false;
 const inputs: Input[] = [], cursors: AudioCursor[] = [], frameIterators: ReturnType<CanvasSink['canvasesAtTimestamps']>[] = [];
 let output: Output | null = null;
 let result: File | null = null, errorCode: string | null = null, affectedRole: string | null = null;
 try {
  const composition = compositionSchema.parse(data.composition);
  if (!composition.main) throw new Error('EDITOR_COMPOSITION_INVALID');
  if (!await canEncodeVideo('avc', { width: 1080, height: 1920, bitrate: 6_000_000 }) || !await canEncodeAudio('aac', { sampleRate: rate, numberOfChannels: 2 })) throw new Error('EDITOR_UNSUPPORTED');
  const parent = await (await navigator.storage.getDirectory()).getDirectoryHandle(data.rootName, { create: true });
  const directory = await parent.getDirectoryHandle(data.attempt, { create: true });
  const count = Math.floor(duration(composition) * fps + 1e-6);
  const videos: Partial<Record<'main' | 'secondary', ReturnType<CanvasSink['canvasesAtTimestamps']>>> = {};
  for (const role of roles) {
   affectedRole = role; checkCancelled();
   const clip = composition[role]; if (!clip) continue;
   const source = (data.media as Record<string, EditorMedia>)[clip.assetId];
   if (!source) throw new Error('EDITOR_MEDIA_UNAVAILABLE');
   const input = new Input({ source: new UrlSource(source.url), formats: ALL_FORMATS }); inputs.push(input);
   if (role === 'main' || role === 'secondary') {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) throw new Error('EDITOR_MEDIA_UNAVAILABLE');
    const times = Array.from({ length: count }, (_, i) => i / fps).filter(time => clipActive(clip, time)).map(time => clip.trimStart + time - clip.start);
    const frames = new CanvasSink(track, { poolSize: 2 }).canvasesAtTimestamps(times); videos[role] = frames; frameIterators.push(frames);
   }
   let audioTrack = await input.getPrimaryAudioTrack(), offset = clip.trimStart;
   if (!audioTrack || clip.muted || !clip.gain) continue;
   if (!await audioTrack.canDecode()) throw new Error('EDITOR_MEDIA_UNAVAILABLE');
   if (audioTrack.sampleRate !== rate || audioTrack.numberOfChannels > 2) {
    const handle = await directory.getFileHandle(`${role}.wav`, { create: true });
    const prepared = new Output({ format: new WavOutputFormat(), target: new StreamTarget(await handle.createWritable(), { chunked: true, chunkSize: 1024 * 1024 }) });
    try {
     const selected = audioTrack;
     conversion = await Conversion.init({ input, output: prepared, video: { discard: true }, audio: candidate => candidate === selected ? { codec: 'pcm-f32', sampleRate: rate, numberOfChannels: 2, forceTranscode: true } : { discard: true }, trim: { start: clip.trimStart, end: clip.trimStart + Math.min(clipDuration(clip), duration(composition) - clip.start) }, showWarnings: false });
     if (!conversion.isValid) throw new Error('EDITOR_MEDIA_UNAVAILABLE');
     checkCancelled(); await conversion.execute();
    } catch (error) { await prepared.cancel().catch(() => undefined); throw error; } finally { conversion = null; }
    const normalized = new Input({ source: new BlobSource(await handle.getFile()), formats: ALL_FORMATS }); inputs.push(normalized);
    audioTrack = await normalized.getPrimaryAudioTrack(); offset = 0;
   }
   if (audioTrack) cursors.push({ role, clip, offset, samples: new AudioSampleSink(audioTrack).samples(offset, offset + clipDuration(clip)), done: false, current: null });
  }
  affectedRole = null; checkCancelled();
  const canvas = new OffscreenCanvas(1080, 1920), context = canvas.getContext('2d', { alpha: false })!;
  let overlay: { canvas: OffscreenCanvas; x: number; y: number } | null = null;
  if (composition.text?.text) {
   const font = new FontFace('EditorArabic', `url(${new URL('/fonts/editor-arabic.ttf', scope.location.href)})`, { weight: '100 900' });
   await font.load(); scope.fonts.add(font); checkCancelled();
   const layout = overlayLayout(context, composition.text), textCanvas = new OffscreenCanvas(layout.width, layout.height);
   paintOverlay(textCanvas.getContext('2d')!, layout);
   overlay = { canvas: textCanvas, x: layout.x - layout.width / 2, y: layout.y - layout.height / 2 };
  }
  const fileHandle = await directory.getFileHandle('video.mp4', { create: true });
  output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(await fileHandle.createWritable(), { chunked: true, chunkSize: 1024 * 1024 }) });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 6_000_000, keyFrameInterval: 2 });
  const audio = new AudioSampleSource({ codec: 'aac', bitrate: 128_000 });
  output.addVideoTrack(video, { frameRate: fps }); output.addAudioTrack(audio); await output.start();
  for (let i = 0; i < count; i++) {
   checkCancelled();
   const time = i / fps, rectangles = videoRects(composition.layout, clipActive(composition.secondary, time));
   for (const role of ['main', 'secondary'] as const) {
    const rect = rectangles[role]; if (!rect || !videos[role]) continue;
    affectedRole = role;
    const frame = (await videos[role]!.next()).value;
    if (!frame) throw new Error('EDITOR_MEDIA_UNAVAILABLE');
    draw(context, frame.canvas, rect);
   }
   if (overlay) context.drawImage(overlay.canvas, overlay.x, overlay.y);
   const pcm = new Float32Array(block * 2);
   for (const cursor of cursors) { affectedRole = cursor.role; await mix(cursor, pcm, time); }
   affectedRole = null;
   for (let sample = 0; sample < pcm.length; sample++) pcm[sample] = Math.max(-1, Math.min(1, pcm[sample]));
   const sample = new AudioSample({ data: pcm, format: 'f32', numberOfChannels: 2, sampleRate: rate, timestamp: time });
   try { await audio.add(sample); } finally { sample.close(); }
   await video.add(time, 1 / fps);
   if (i % 15 === 0) scope.postMessage({ type: 'progress', progress: 100 * (i + 1) / count });
  }
  video.close(); audio.close(); await output.finalize(); output = null; checkCancelled();
  result = await fileHandle.getFile();
  for (const role of roles) await directory.removeEntry(`${role}.wav`).catch(() => undefined);
 } catch (error) {
  await output?.cancel().catch(() => undefined);
  errorCode = cancelled ? 'EDITOR_CANCELLED' : error instanceof DOMException && error.name === 'QuotaExceededError' ? 'EDITOR_STORAGE_FULL' : error instanceof Error && error.message.startsWith('EDITOR_') ? error.message : 'EDITOR_EXPORT_FAILED';
 } finally {
  await Promise.allSettled([...frameIterators.map(iterator => iterator.return(undefined)), ...cursors.map(cursor => cursor.samples.return(undefined))]);
  for (const input of inputs) input.dispose();
 }
 scope.postMessage(errorCode ? { type: 'error', code: errorCode, role: affectedRole } : { type: 'done', file: result });
};
