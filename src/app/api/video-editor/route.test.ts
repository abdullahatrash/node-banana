// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), asset: vi.fn() }));
vi.mock('@/lib/db', () => ({ isDatabaseConfigured: () => true }));
vi.mock('@/lib/studio/authz', () => ({ authorizeStudioRequest: mocks.authorize, authzErrorResponse: () => new Response('{}', { status: 403 }) }));
vi.mock('@/lib/product-surfaces/repository', () => ({ listProductRecords: mocks.list, createProductRecord: mocks.create, updateProductRecord: mocks.update, ProductRecordConflictError: class extends Error {}, ProductRecordIdempotencyError: class extends Error {} }));
vi.mock('@/lib/studio/repository', () => ({ getAsset: mocks.asset }));
vi.mock('@/lib/agent-runtime/safe-diagnostics', () => ({ recordSafeOperationalTrace: vi.fn() }));
import { GET, POST } from './route';
const composition = { version: 1, title: 'Coffee', main: { assetId: 'main', trimStart: 1, trimEnd: 6, start: 0, gain: 1, muted: false } };
const request = (body: unknown) => new NextRequest('http://localhost/api/video-editor', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
beforeEach(() => {
 vi.clearAllMocks();
 mocks.authorize.mockResolvedValue({ authorized: true, workspaceId: 'ws', userId: 'user' });
 mocks.asset.mockResolvedValue({ id: 'main', type: 'video', checksum: 'sha256:verified', width: 1080, height: 1920, durationSeconds: 10, metadata: { uploadState: 'ready' } });
 mocks.list.mockResolvedValue([]);
 mocks.create.mockImplementation(async (input) => ({ id: 'piece', revision: 1, ...input }));
});
describe('Workspace Video Editor drafts', () => {
 it('saves a main-video trim and reopens it through the public editor API', async () => {
  const response = await POST(request({ composition, idempotencyKey: 'save-main-001' }));
  expect(response.status).toBe(200);
  const saved = (await response.json()).record;
  expect(saved.composition).toMatchObject(composition);
  mocks.list.mockResolvedValue([{ id: saved.id, revision: 1, kind: 'content_piece', payload: { videoEditor: composition } }]);
  const reopened = await GET(new NextRequest('http://localhost/api/video-editor'));
  expect((await reopened.json()).records[0]).toMatchObject({ id: saved.id, composition });
 });
});

it('saves a timed Secondary video and rejects a segment longer than 15 seconds', async () => {
 const secondary = { ...composition.main, assetId: 'secondary', trimStart: 0, trimEnd: 2, start: 2 };
 const next = { ...composition, secondary, layout: 'stacked' };
 const response = await POST(request({ composition: next, idempotencyKey: 'two-video-001' }));
 expect(response.status).toBe(200);
 expect((await response.json()).record.composition.secondary).toEqual(secondary);
 const invalid = await POST(request({ composition: { ...next, secondary: { ...secondary, trimEnd: 16 } }, idempotencyKey: 'two-video-002' }));
 expect(invalid.status).toBe(400);
});
