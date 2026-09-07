import { compositionSchema, type Composition, type EditorMedia } from './composition';
export interface ExportResult { file: File; release(): Promise<void> }
export interface ExportOptions { signal: AbortSignal; onProgress(value: number): void }
const ROOT = 'tasmeemai-video-editor-v1';
export async function exportComposition(composition: Composition, media: Record<string, EditorMedia>, options: ExportOptions): Promise<ExportResult> {
 compositionSchema.parse(composition);
 if (!composition.main) throw new Error('EDITOR_COMPOSITION_INVALID');
 if (!globalThis.Worker || !globalThis.VideoEncoder || !navigator.storage?.getDirectory || !navigator.locks || !globalThis.OffscreenCanvas) throw new Error('EDITOR_UNSUPPORTED');
 const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create: true });
 // A live attempt holds its lock until the download is released. Recover only orphan attempts.
 for await (const [name] of (root as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
  if (!/^[a-f0-9-]{36}$/.test(name)) continue;
  await navigator.locks.request(`${ROOT}:${name}`, { ifAvailable: true }, async (lock) => { if (lock) await root.removeEntry(name, { recursive: true }); });
 }
 const attempt = crypto.randomUUID();
 return new Promise<ExportResult>((resolve, reject) => {
  void navigator.locks.request(`${ROOT}:${attempt}`, async () => {
   let releaseLock!: () => void;
   const released = new Promise<void>((done) => { releaseLock = done; });
   const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
   let settled = false;
   const remove = async () => { worker.terminate(); options.signal.removeEventListener('abort', cancel); await root.removeEntry(attempt, { recursive: true }).catch(() => undefined); releaseLock(); };
   const fail = async (code: string) => { if (settled) return; settled = true; await remove(); reject(new Error(code)); };
   const cancel = () => worker.postMessage({ type: 'cancel' });
   worker.onerror = () => { void fail('EDITOR_EXPORT_FAILED'); };
   worker.onmessage = ({ data }) => {
    if (data.type === 'progress') options.onProgress(data.progress);
    else if (data.type === 'done') { settled = true; options.signal.removeEventListener('abort', cancel); resolve({ file: data.file, release: remove }); }
    else void fail(data.code || 'EDITOR_EXPORT_FAILED');
   };
   options.signal.addEventListener('abort', cancel, { once: true });
   if (options.signal.aborted) { await fail('EDITOR_CANCELLED'); return; }
   worker.postMessage({ type: 'export', composition, media, rootName: ROOT, attempt });
   await released;
  }).catch(reject);
 });
}
