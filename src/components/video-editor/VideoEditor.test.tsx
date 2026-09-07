import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { VideoEditor } from './VideoEditor';
const exporter = vi.hoisted(() => vi.fn());
vi.mock('@/lib/video-editor/export-client', () => ({ exportComposition: exporter }));
beforeEach(() => {
 vi.clearAllMocks(); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); localStorage.setItem('node-banana-active-workspace-id', 'ws');
 let saved: unknown[] = [];
 vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
  if (url === '/api/video-editor' && init?.method === 'POST') {
   const input = JSON.parse(String(init.body)); const record = { id: 'piece', revision: 1, composition: input.composition }; saved = [record];
   return Response.json({ success: true, record });
  }
  if (url === '/api/video-editor') return Response.json({ success: true, records: saved });
  if (url.startsWith('/api/product-library/assets')) return Response.json({ success: true, items: [{ id: 'main', name: 'Phone footage', type: 'video', durationSeconds: 10, width: 1080, height: 1920 }], nextCursor: null });
  if (url === '/api/studio/assets/main') return Response.json({ success: true, asset: { type: 'video', durationSeconds: 10, width: 1080, height: 1920, metadata: { originalFileName: 'Phone footage' } } });
  if (url.endsWith('/download')) return Response.json({ success: true, downloadUrl: 'https://media.example/main.mp4' });
  return Response.json({}, { status: 404 });
 }));
 exporter.mockResolvedValue({ file: new File(['mp4'], 'video.mp4', { type: 'video/mp4' }), release: vi.fn() });
 vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:export'), revokeObjectURL: vi.fn() }));
});
it('selects Workspace footage, saves a trim, reopens, and requests an export of that composition', async () => {
 const view = render(<VideoEditor locale="en" />);
 fireEvent.click(await screen.findByRole('button', { name: /Phone footage/ }));
 fireEvent.change(await screen.findByLabelText('Trim end'), { target: { value: '5' } });
 fireEvent.click(screen.getByRole('button', { name: 'Save' }));
 await screen.findByText('Saved');
 view.unmount();
 render(<VideoEditor locale="en" initialId="piece" />);
 await waitFor(() => expect(screen.getByLabelText('Trim end')).toHaveValue(5));
 fireEvent.click(screen.getByRole('button', { name: 'Export video' }));
 await screen.findByRole('link', { name: 'Download video' });
 expect(exporter.mock.calls[0][0].main).toMatchObject({ assetId: 'main', trimStart: 0, trimEnd: 5 });
});

it('retains the selected trim after a quota denial and allows another upload attempt', async () => {
 render(<VideoEditor locale="en" />);
 fireEvent.click(await screen.findByRole('button', { name: /Phone footage/ }));
 fireEvent.change(await screen.findByLabelText('Trim end'), { target: { value: '5' } });
 const original = vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation(async (url, init) => String(url).endsWith('/presign') ? Response.json({ success: false }, { status: 403 }) : original(url, init));
 fireEvent.change(screen.getByLabelText('Upload video or audio'), { target: { files: [new File(['test'], 'phone.mp4', { type: 'video/mp4' })] } });
 await screen.findByRole('alert');
 expect(screen.getByLabelText('Trim end')).toHaveValue(5);
 expect(screen.getByLabelText('Upload video or audio')).toBeEnabled();
});
