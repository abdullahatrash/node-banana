// THROWAWAY: local performance experiment, never a production route.
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const require = createRequire(import.meta.url);
const library = process.env.PROTOTYPE_DEPENDENCY_ROOT
  ? join(process.env.PROTOTYPE_DEPENDENCY_ROOT, 'mediabunny/dist/bundles/mediabunny.mjs')
  : require.resolve('mediabunny').replace(/mediabunny\.cjs$/, 'mediabunny.mjs');
const media = process.env.PROTOTYPE_MEDIA_DIR || join(tmpdir(), 'tasmeemai-throwaway-reaction-export-v1');
await mkdir(media, { recursive: true });
// Synthetic moving footage and distinct audio tones. No external assets or AI calls.
const fixtures = [
  ['main.mp4', ['-f','lavfi','-i','testsrc2=size=1080x1920:rate=30','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','60','-c:v','libx264','-preset','ultrafast','-crf','28','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart']],
  ['reaction.mp4', ['-f','lavfi','-i','testsrc2=size=720x1280:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','15','-vf','hue=h=100','-c:v','libx264','-preset','ultrafast','-crf','28','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart']],
  ['music.wav', ['-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-t','60','-ac','2']],
  ['voice.wav', ['-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','10','-ac','2']],
];
for (const [name, args] of fixtures) {
  if (!existsSync(join(media, name))) {
    console.log(`Preparing local synthetic fixture: ${name}`);
    await run('ffmpeg', ['-nostdin','-hide_banner','-loglevel','error',...args,join(media,name)], { timeout: 180_000 });
  }
}
const routes = new Map([
  ['/', [join(here,'index.html'),'text/html']],
  ['/app.mjs', [join(here,'app.mjs'),'text/javascript']],
  ['/worker.mjs', [join(here,'worker.mjs'),'text/javascript']],
  ['/overlay.mjs', [join(here,'overlay.mjs'),'text/javascript']],
  ['/mediabunny.mjs', [library,'text/javascript']],
  ['/font.ttf', [join(root,'assets/fonts/creative/NotoSansArabic.ttf'),'font/ttf']],
  ...fixtures.map(([name]) => [`/media/${name}`,[join(media,name),name.endsWith('.mp4')?'video/mp4':'audio/wav']]),
]);
createServer(async (req, res) => {
  const resource = routes.get(new URL(req.url, 'http://localhost').pathname);
  if (!resource || !['GET','HEAD'].includes(req.method)) { res.writeHead(404).end(); return; }
  try {
    const [path,type] = resource; const { size } = await stat(path);
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]),size-1) : size-1;
    if (start > end || start >= size) { res.writeHead(416).end(); return; }
    res.writeHead(range?206:200, {'Content-Type':type,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store',...(range?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
    if (req.method === 'HEAD') res.end(); else createReadStream(path,{start,end}).pipe(res);
  } catch (error) { res.writeHead(500).end(String(error)); }
}).listen(Number(process.env.PROTOTYPE_PORT || 3047),'127.0.0.1', () => {
  console.log(`Throwaway reaction export: http://127.0.0.1:${process.env.PROTOTYPE_PORT || 3047}`);
  console.log(`Synthetic fixtures: ${media}`);
});
