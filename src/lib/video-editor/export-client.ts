import { compositionSchema, type Composition, type EditorMedia } from './composition';
export interface ExportResult { file: File; release(): Promise<void> }
export interface ExportOptions { signal: AbortSignal; onProgress(value: number): void }
const ROOT = 'tasmeemai-video-editor-v1';
function failure(error: unknown) {
 return new Error(error instanceof DOMException && error.name === 'QuotaExceededError' ? 'EDITOR_STORAGE_FULL' : error instanceof Error && error.message.startsWith('EDITOR_') ? error.message : 'EDITOR_EXPORT_FAILED');
}
export async function exportComposition(composition: Composition, media: Record<string, EditorMedia>, options: ExportOptions): Promise<ExportResult> {
 if (!compositionSchema.safeParse(composition).success || !composition.main) throw new Error('EDITOR_COMPOSITION_INVALID');
 if (!globalThis.Worker || !globalThis.VideoEncoder || !globalThis.AudioEncoder || !navigator.storage?.getDirectory || !navigator.locks || !globalThis.OffscreenCanvas) throw new Error('EDITOR_UNSUPPORTED');
 if (options.signal.aborted) throw new Error('EDITOR_CANCELLED');
 try {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create: true });
  // Locks isolate tabs. Sweep a bounded number of orphan attempts, never Workspace media.
  let inspected = 0;
  for await (const [name] of (root as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
   if (++inspected > 100) break;
   if (!/^[a-f0-9-]{36}$/.test(name)) continue;
   await navigator.locks.request(`${ROOT}:${name}`, { ifAvailable: true }, async lock => { if (lock) await root.removeEntry(name, { recursive: true }); });
  }
  const attempt = crypto.randomUUID();
  return await new Promise<ExportResult>((resolve, reject) => {
   void navigator.locks.request(`${ROOT}:${attempt}`, async () => {
    let releaseLock!: () => void;
    const released = new Promise<void>(done => { releaseLock = done; });
    const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
    let settled = false, removing: Promise<void> | null = null, cancelTimer: ReturnType<typeof setTimeout> | undefined;
    const remove = () => removing ||= (async () => {
     clearTimeout(cancelTimer); worker.terminate(); options.signal.removeEventListener('abort', cancel);
     try {
      // A terminated writer may need a moment to release its file handle.
      for (let retry = 0; retry < 3; retry++) {
       try { await root.removeEntry(attempt, { recursive: true }); return; }
       catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return; if (retry === 2) throw error; await new Promise(done => setTimeout(done, 100 * (retry + 1))); }
      }
     } finally { releaseLock(); }
    })();
    const fail = async (code: string) => { if (settled) return; settled = true; try { await remove(); } catch { /* Next attempt sweeps an orphan after the lock is released. */ } reject(new Error(code)); };
    const cancel = () => { worker.postMessage({ type: 'cancel' }); cancelTimer = setTimeout(() => void fail('EDITOR_CANCELLED'), 1000); };
    worker.onerror = () => { void fail('EDITOR_EXPORT_FAILED'); };
    worker.onmessage = ({ data }) => {
     if (settled) return;
     if (data.type === 'progress') options.onProgress(data.progress);
     else if (data.type === 'done') {
      if (options.signal.aborted) { void fail('EDITOR_CANCELLED'); return; }
      settled = true; clearTimeout(cancelTimer); options.signal.removeEventListener('abort', cancel); resolve({ file: data.file, release: remove });
     } else void fail(`${data.code || 'EDITOR_EXPORT_FAILED'}${data.role ? `:${data.role}` : ''}`);
    };
    options.signal.addEventListener('abort', cancel, { once: true });
    if (options.signal.aborted) { await fail('EDITOR_CANCELLED'); return; }
    worker.postMessage({ type: 'export', composition, media, rootName: ROOT, attempt });
    await released;
   }).catch(reject);
  });
 } catch (error) { throw failure(error); }
}
