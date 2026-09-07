import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, stat, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
const root = resolve(import.meta.dirname, "../..");
const out = join(tmpdir(), "tasmeemai-editor-acceptance");
const fixtures =
  process.env.EDITOR_FIXTURES ||
  join(tmpdir(), "tasmeemai-throwaway-reaction-export-v1");
await mkdir(out, { recursive: true });
await build({
  entryPoints: [join(root, "scripts/video-editor/entry.tsx")],
  outfile: join(out, "app.js"),
  bundle: true,
  format: "esm",
  jsx: "automatic",
  sourcemap: true,
  define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
  external: ["/fonts/*"],
});
await build({
  entryPoints: [join(root, "src/lib/video-editor/export.worker.ts")],
  outfile: join(out, "export.worker.ts"),
  bundle: true,
  format: "esm",
  sourcemap: true,
});
await build({
  entryPoints: [join(root, "src/lib/video-editor/probe.worker.ts")],
  outfile: join(out, "probe.worker.ts"),
  bundle: true,
  format: "esm",
});
const port = Number(process.env.EDITOR_TEST_PORT || 3048);
const origin = `http://127.0.0.1:${port}`;
const assets = new Map([
  [
    "main",
    {
      id: "main",
      name: "Phone footage",
      type: "video",
      durationSeconds: 60,
      width: 1080,
      height: 1920,
      file: "main.mp4",
    },
  ],
  [
    "secondary",
    {
      id: "secondary",
      name: "AI influencer",
      type: "video",
      durationSeconds: 15,
      width: 720,
      height: 1280,
      file: "reaction.mp4",
    },
  ],
  [
    "music",
    {
      id: "music",
      name: "Music",
      type: "audio",
      durationSeconds: 60,
      width: null,
      height: null,
      file: "music-44100.mp3",
    },
  ],
  [
    "voiceover",
    {
      id: "voiceover",
      name: "Voice over",
      type: "audio",
      durationSeconds: 10,
      width: null,
      height: null,
      file: "voice-24000.wav",
    },
  ],
]);
const pendingUploads = new Map();
let records = JSON.parse(
  await readFile(join(out, "records.json"), "utf8").catch(() => "[]"),
);
const server = createServer(async (req, res) => {
  const url = new URL(req.url, origin),
    path = url.pathname;
  const json = (value, status = 200) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  try {
    if (/^\/upload\/[a-f0-9-]{36}$/.test(path) && req.method === "PUT") {
      const id = path.split("/").at(-1),
        item = pendingUploads.get(id);
      if (!item) return json({ success: false }, 404);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      await writeFile(join(fixtures, item.file), Buffer.concat(chunks));
      return json({ success: true });
    }
    if (path.startsWith("/api/")) {
      if (req.headers["x-workspace-id"] !== "editor-local-fixture")
        return json({ success: false }, 403);
      if (path === "/api/studio/assets/presign") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body),
          id = crypto.randomUUID();
        pendingUploads.set(id, {
          id,
          name: data.fileName,
          type: data.assetType,
          file: `${id}.media`,
        });
        return json({
          success: true,
          assetId: id,
          uploadUrl: `${origin}/upload/${id}`,
        });
      }
      if (req.method === "PATCH" && path.startsWith("/api/studio/assets/")) {
        const id = path.split("/").at(-1),
          item = pendingUploads.get(id);
        if (!item) return json({ success: false }, 404);
        try {
          const { stdout } = await run("ffprobe", [
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            join(fixtures, item.file),
          ]);
          const metadata = JSON.parse(stdout),
            track = metadata.streams.find(
              (track) => track.codec_type === item.type,
            );
          if (!track) throw Error("wrong type");
          const asset = {
            ...item,
            durationSeconds: Number(metadata.format.duration),
            width: track.width || null,
            height: track.height || null,
          };
          assets.set(id, asset);
          pendingUploads.delete(id);
          return json({ success: true, asset });
        } catch {
          return json(
            { success: false, code: "EDITOR_MEDIA_UNAVAILABLE" },
            422,
          );
        }
      }
      if (path === "/api/product-library/assets")
        return json({
          success: true,
          items: [...assets.values()],
          nextCursor: null,
        });
      if (path === "/api/video-editor") {
        if (req.method === "GET") return json({ success: true, records });
        let body = "";
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body),
          existing = records.find((item) => item.id === data.id);
        if (data.id && existing?.revision !== data.expectedRevision)
          return json({ success: false, code: "EDITOR_SAVE_CONFLICT" }, 409);
        const record = {
          id: data.id || crypto.randomUUID(),
          revision: (existing?.revision || 0) + 1,
          composition: data.composition,
        };
        records = [record, ...records.filter((item) => item.id !== record.id)];
        await writeFile(join(out, "records.json"), JSON.stringify(records));
        return json({ success: true, record });
      }
      const match = /^\/api\/studio\/assets\/([^/]+)(\/download)?$/.exec(path);
      if (match && assets.has(match[1])) {
        const asset = assets.get(match[1]);
        return json(
          match[2]
            ? { success: true, downloadUrl: `${origin}/media/${asset.file}` }
            : {
                success: true,
                asset: { ...asset, metadata: { originalFileName: asset.name } },
              },
        );
      }
      return json({ success: false }, 404);
    }
    if (path === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    if (path === "/" || path === "/editor" || path.startsWith("/editor/")) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Video editor · local acceptance</title><link rel="stylesheet" href="/app.css"><style>body{margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>',
      );
    }
    const resource = path.startsWith("/media/")
      ? join(fixtures, path.split("/").at(-1))
      : ["/fonts/editor-arabic.ttf", "/fonts/editor-cairo.ttf", "/fonts/editor-naskh.ttf"].includes(path)
        ? join(root, "public", path)
        : [
              "/app.js",
              "/app.css",
              "/export.worker.ts",
              "/probe.worker.ts",
              "/app.js.map",
              "/export.worker.ts.map",
            ].includes(path)
          ? join(out, path)
          : null;
    if (!resource) {
      res.writeHead(404).end();
      return;
    }
    const { size } = await stat(resource),
      range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    const start = range ? Number(range[1]) : 0,
      end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416).end();
      return;
    }
    const type = /\.(js|ts)$/.test(path)
      ? "text/javascript"
      : path.endsWith(".css")
        ? "text/css"
        : path.endsWith(".mp4")
          ? "video/mp4"
          : path.endsWith(".wav")
            ? "audio/wav"
            : "application/octet-stream";
    res.writeHead(range ? 206 : 200, {
      "content-type": type,
      "content-length": end - start + 1,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
    });
    createReadStream(resource, { start, end }).pipe(res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json({ success: false }, 500);
    else res.end();
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Local fixture service (not production auth): ${origin}`),
);
