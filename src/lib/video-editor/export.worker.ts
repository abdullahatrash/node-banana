/// <reference lib="webworker" />
import { Input, UrlSource, ALL_FORMATS, CanvasSink, CanvasSource, AudioSample, AudioSampleSink, AudioSampleSource, Output, Mp4OutputFormat, StreamTarget, Conversion, WavOutputFormat, BlobSource, canEncodeVideo, canEncodeAudio } from 'mediabunny-editor';
import { compositionSchema, duration, VIDEO_FPS, type EditorMedia } from './composition';
const scope = self as unknown as DedicatedWorkerGlobalScope;
let cancelled = false;
let conversion: Conversion | null = null;
scope.onmessage = async ({ data }) => {
 if (data.type === 'cancel') { cancelled = true; await conversion?.cancel().catch(() => undefined); return; }
 if (data.type !== 'export') return;
 cancelled = false;
 const inputs: Input[] = [];
 let frames: ReturnType<CanvasSink['canvasesAtTimestamps']> | null = null;
 let samples: ReturnType<AudioSampleSink['samples']> | null = null;
 let output: Output | null = null;
 let directory: FileSystemDirectoryHandle | null = null;
 try {
  const composition = compositionSchema.parse(data.composition), main = composition.main;
  if (!main) throw new Error('EDITOR_COMPOSITION_INVALID');
  if (!await canEncodeVideo('avc', { width: 1080, height: 1920, bitrate: 6_000_000 }) || !await canEncodeAudio('aac', { sampleRate: 48000, numberOfChannels: 2 })) throw new Error('EDITOR_UNSUPPORTED');
  const parent = await (await navigator.storage.getDirectory()).getDirectoryHandle(data.rootName, { create: true });
  directory = await parent.getDirectoryHandle(data.attempt, { create: true });
  const source = (data.media as Record<string, EditorMedia>)[main.assetId];
  if (!source) throw new Error('EDITOR_MEDIA_UNAVAILABLE');
  const input = new Input({ source: new UrlSource(source.url), formats: ALL_FORMATS }); inputs.push(input);
  const track = await input.getPrimaryVideoTrack();
  if (!track || !await track.canDecode()) throw new Error('EDITOR_MEDIA_UNAVAILABLE');
  const fps = VIDEO_FPS, rate = 48000, block = rate / fps, count = Math.floor(duration(composition) * fps + 1e-6);
  frames = new CanvasSink(track, { poolSize: 2 }).canvasesAtTimestamps(Array.from({ length: count }, (_, i) => main.trimStart + i / fps));
  let audioTrack = await input.getPrimaryAudioTrack(), audioStart = main.trimStart;
  if (audioTrack && !main.muted && main.gain && (audioTrack.sampleRate !== rate || audioTrack.numberOfChannels > 2)) {
   const handle = await directory.getFileHandle('main.wav', { create: true });
   const prepared = new Output({ format: new WavOutputFormat(), target: new StreamTarget(await handle.createWritable(), { chunked: true, chunkSize: 1024 * 1024 }) });
   try {
    const selected = audioTrack;
    conversion = await Conversion.init({ input, output: prepared, video: { discard: true }, audio: (candidate) => candidate === selected ? { codec: 'pcm-f32', sampleRate: rate, numberOfChannels: 2, forceTranscode: true } : { discard: true }, trim: { start: main.trimStart, end: main.trimEnd }, showWarnings: false });
    if (!conversion.isValid) throw new Error('EDITOR_MEDIA_UNAVAILABLE');
    if (cancelled) throw new Error('EDITOR_CANCELLED');
    await conversion.execute();
   } catch (error) { await prepared.cancel().catch(() => undefined); throw error; } finally { conversion = null; }
   const normalized = new Input({ source: new BlobSource(await handle.getFile()), formats: ALL_FORMATS }); inputs.push(normalized);
   audioTrack = await normalized.getPrimaryAudioTrack(); audioStart = 0;
  }
  if (audioTrack && !main.muted && main.gain) samples = new AudioSampleSink(audioTrack).samples(audioStart, audioStart + duration(composition));
  let current: { pcm: Float32Array; channels: number; frames: number; start: number; end: number } | null = null;
  let done = !samples;
  const canvas = new OffscreenCanvas(1080, 1920), context = canvas.getContext('2d', { alpha: false })!;
  const fileHandle = await directory.getFileHandle('video.mp4', { create: true });
  output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(await fileHandle.createWritable(), { chunked: true, chunkSize: 1024 * 1024 }) });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 6_000_000, keyFrameInterval: 2 });
  const audio = new AudioSampleSource({ codec: 'aac', bitrate: 128_000 });
  output.addVideoTrack(video, { frameRate: fps }); output.addAudioTrack(audio); await output.start();
  for (let i = 0; i < count; i++) {
   if (cancelled) throw new Error('EDITOR_CANCELLED');
   const frame = (await frames.next()).value;
   if (!frame) throw new Error('EDITOR_MEDIA_UNAVAILABLE');
   const scale = Math.max(1080 / frame.canvas.width, 1920 / frame.canvas.height), sw = 1080 / scale, sh = 1920 / scale;
   context.drawImage(frame.canvas, (frame.canvas.width - sw) / 2, (frame.canvas.height - sh) / 2, sw, sh, 0, 0, 1080, 1920);
   const pcm = new Float32Array(block * 2);
   for (let j = 0; j < block; j++) {
    const time = audioStart + i / fps + j / rate;
    while (!done && (!current || time >= current.end - 1e-9)) {
     const item = await samples!.next(); done = Boolean(item.done);
     if (item.done) { current = null; break; }
     const sample = item.value;
     try {
      if (sample.sampleRate !== rate || sample.numberOfChannels > 2) throw new Error('EDITOR_MEDIA_UNAVAILABLE');
      const values = new Float32Array(sample.numberOfFrames * sample.numberOfChannels); sample.copyTo(values, { planeIndex: 0, format: 'f32' });
      current = { pcm: values, channels: sample.numberOfChannels, frames: sample.numberOfFrames, start: sample.timestamp, end: sample.timestamp + sample.duration };
     } finally { sample.close(); }
    }
    if (!current || time < current.start) continue;
    const index = Math.min(current.frames - 1, Math.max(0, Math.floor((time - current.start) * rate + 1e-6)));
    pcm[j * 2] = current.pcm[index * current.channels] * main.gain;
    pcm[j * 2 + 1] = current.pcm[index * current.channels + (current.channels === 2 ? 1 : 0)] * main.gain;
   }
   const sample = new AudioSample({ data: pcm, format: 'f32', numberOfChannels: 2, sampleRate: rate, timestamp: i / fps });
   try { await audio.add(sample); } finally { sample.close(); }
   await video.add(i / fps, 1 / fps);
   if (i % 15 === 0) scope.postMessage({ type: 'progress', progress: 100 * (i + 1) / count });
  }
  video.close(); audio.close(); await output.finalize(); output = null;
  for (const input of inputs) input.dispose();
  await directory.removeEntry('main.wav').catch(() => undefined);
  scope.postMessage({ type: 'done', file: await fileHandle.getFile() });
 } catch (error) {
  await output?.cancel().catch(() => undefined);
  scope.postMessage({ type: 'error', code: cancelled ? 'EDITOR_CANCELLED' : error instanceof DOMException && error.name === 'QuotaExceededError' ? 'EDITOR_STORAGE_FULL' : error instanceof Error && error.message.startsWith('EDITOR_') ? error.message : 'EDITOR_EXPORT_FAILED' });
 } finally {
  await frames?.return(undefined); await samples?.return(undefined);
  for (const input of inputs) input.dispose();
 }
};
