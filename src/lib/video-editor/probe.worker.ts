/// <reference lib="webworker" />
import { ALL_FORMATS, Input, UrlSource } from "mediabunny-editor";
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async ({
  data,
}: MessageEvent<{ url: string; type: "audio" | "video" }>) => {
  const input = new Input({
    source: new UrlSource(data.url),
    formats: ALL_FORMATS,
  });
  try {
    const video =
      data.type === "video" ? await input.getPrimaryVideoTrack() : null;
    const track =
      data.type === "video" ? video : await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) throw new Error("unavailable");
    const duration = await track.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("unavailable");
    scope.postMessage({
      duration,
      width: video?.displayWidth || 0,
      height: video?.displayHeight || 0,
    });
  } catch {
    scope.postMessage({ error: "EDITOR_MEDIA_UNAVAILABLE" });
  } finally {
    input.dispose();
  }
};
