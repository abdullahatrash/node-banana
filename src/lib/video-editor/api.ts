import { getActiveWorkspaceId } from '@/lib/studio/client';
import { compositionSchema, type Composition, type EditorRecord, type EditorMedia } from './composition';

export class EditorApiError extends Error {
  constructor(public code: string, public status = 0) { super(code); }
}
export async function editorRequest(path: string, body?: unknown, method = body ? 'POST' : 'GET') {
  const workspace = getActiveWorkspaceId();
  if (!workspace) throw new EditorApiError('WORKSPACE_REQUIRED');
  const response = await fetch(path, { method, cache: 'no-store', headers: { 'x-workspace-id': workspace, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok || !data.success) throw new EditorApiError(data.code || (response.status === 403 ? 'EDITOR_ACCESS_OR_QUOTA' : 'EDITOR_REQUEST_FAILED'), response.status);
  return data;
}
export async function loadRecords(): Promise<EditorRecord[]> {
  const { records } = await editorRequest('/api/video-editor');
  return records.map((record: EditorRecord) => ({ ...record, composition: compositionSchema.parse(record.composition) }));
}
export async function saveComposition(composition: Composition, current: EditorRecord | null, key: string): Promise<EditorRecord> {
  const { record } = await editorRequest('/api/video-editor', { composition: compositionSchema.parse(composition), ...(current ? { id: current.id, expectedRevision: current.revision } : {}), idempotencyKey: key });
  return { ...record, composition: compositionSchema.parse(record.composition) };
}
export interface MediaItem { id: string; name: string; type: string; durationSeconds: number | null; width: number | null; height: number | null }
export async function listMedia(cursor: string | null = null): Promise<{ items: MediaItem[]; nextCursor: string | null }> {
  return editorRequest(`/api/product-library/assets${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
}
export async function resolveMedia(item: MediaItem): Promise<EditorMedia> {
  const { downloadUrl } = await editorRequest(`/api/studio/assets/${encodeURIComponent(item.id)}/download`);
  if (item.type !== 'video' && item.type !== 'audio') throw new EditorApiError('EDITOR_MEDIA_UNAVAILABLE');
  return { id: item.id, name: item.name, type: item.type, duration: item.durationSeconds || 0, width: item.width || 0, height: item.height || 0, url: downloadUrl };
}
