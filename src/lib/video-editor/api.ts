import { compositionSchema, type Composition, type EditorRecord, type EditorMedia } from './composition';

export class EditorApiError extends Error {
  constructor(public code: string, public status = 0) { super(code); }
}
export function createEditorClient(workspace: string | null) {
async function editorRequest(path: string, body?: unknown, method = body ? 'POST' : 'GET') {
  if (!workspace) throw new EditorApiError('WORKSPACE_REQUIRED');
  const response = await fetch(path, { method, cache: 'no-store', headers: { 'x-workspace-id': workspace, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok || !data.success) throw new EditorApiError(data.code || (response.status === 403 ? 'EDITOR_ACCESS_OR_QUOTA' : 'EDITOR_REQUEST_FAILED'), response.status);
  return data;
}
async function loadRecords(id?: string): Promise<EditorRecord[]> {
  const { records } = await editorRequest(`/api/video-editor${id ? `?id=${encodeURIComponent(id)}` : ''}`);
  return records.map((record: EditorRecord) => ({ ...record, composition: compositionSchema.parse(record.composition) }));
}
async function saveComposition(composition: Composition, current: EditorRecord | null, key: string): Promise<EditorRecord> {
  const { record } = await editorRequest('/api/video-editor', { composition: compositionSchema.parse(composition), ...(current ? { id: current.id, expectedRevision: current.revision } : {}), idempotencyKey: key });
  return { ...record, composition: compositionSchema.parse(record.composition) };
}

async function listMedia(cursor: string | null = null): Promise<{ items: MediaItem[]; nextCursor: string | null }> {
  return editorRequest(`/api/product-library/assets${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
}
async function resolveMedia(item: MediaItem): Promise<EditorMedia> {
  const { downloadUrl } = await editorRequest(`/api/studio/assets/${encodeURIComponent(item.id)}/download`);
  if (item.type !== 'video' && item.type !== 'audio') throw new EditorApiError('EDITOR_MEDIA_UNAVAILABLE');
  // Lazy metadata inspection: avoid loading codec tooling until a creator selects media.
  const { Input, UrlSource, ALL_FORMATS } = await import('mediabunny-editor');
  const input = new Input({ source: new UrlSource(downloadUrl), formats: ALL_FORMATS });
  try {
    const video = item.type === 'video' ? await input.getPrimaryVideoTrack() : null;
    const track = video || await input.getPrimaryAudioTrack();
    if (!track || !await track.canDecode()) throw new EditorApiError('EDITOR_MEDIA_UNAVAILABLE');
    const seconds = await track.computeDuration();
    if (!Number.isFinite(seconds) || seconds <= 0) throw new EditorApiError('EDITOR_MEDIA_UNAVAILABLE');
    return { id: item.id, name: item.name, type: item.type, duration: seconds, width: video?.displayWidth || 0, height: video?.displayHeight || 0, url: downloadUrl };
  } finally { input.dispose(); }
}

/** Upload uses the same reservation, quota and server inspection path as Workspace media. */
async function uploadMedia(file: File, onPhase: (phase: 'uploading' | 'processing') => void): Promise<MediaItem> {
  const type = /^(video\/(mp4|webm|quicktime))$/.test(file.type) ? 'video' : /^(audio\/(mpeg|mp3|wav|x-wav|wave))$/.test(file.type) ? 'audio' : null;
  if (!type || !file.size || file.size > 500 * 1024 * 1024) throw new EditorApiError('EDITOR_UPLOAD_FORMAT');
  onPhase('uploading');
  const { assetId, uploadUrl } = await editorRequest('/api/studio/assets/presign', { fileName: file.name, contentType: file.type, assetType: type, expectedSizeBytes: file.size });
  try {
    const uploaded = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
    if (!uploaded.ok) throw new EditorApiError('EDITOR_UPLOAD_FAILED');
    onPhase('processing');
    const { asset } = await editorRequest(`/api/studio/assets/${encodeURIComponent(assetId)}`, { uploadState: 'ready' }, 'PATCH');
    return { id: assetId, name: file.name, type, durationSeconds: asset.durationSeconds, width: asset.width, height: asset.height };
  } catch (error) {
    await editorRequest(`/api/studio/assets/${encodeURIComponent(assetId)}`, { uploadState: 'failed', error: 'Editor upload did not complete' }, 'PATCH').catch(() => undefined);
    throw error;
  }
}

 return { request: editorRequest, loadRecords, saveComposition, listMedia, resolveMedia, uploadMedia };
}
export interface MediaItem { id: string; name: string; type: string; durationSeconds: number | null; width: number | null; height: number | null }
export type EditorClient = ReturnType<typeof createEditorClient>;
