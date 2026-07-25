const KNOWN_3D_EXTENSIONS = new Set([
  "glb",
  "gltf",
  "obj",
  "fbx",
  "usdz",
  "stl",
  "ply",
]);
const KNOWN_MEDIA_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "mp4",
  "webm",
  "mov",
]);

export function getExtensionFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const lastDot = pathname.lastIndexOf(".");
    if (lastDot === -1 || lastDot === pathname.length - 1) return null;
    const ext = pathname.substring(lastDot + 1).toLowerCase();
    if (
      KNOWN_3D_EXTENSIONS.has(ext) ||
      KNOWN_MEDIA_EXTENSIONS.has(ext)
    ) {
      return ext;
    }
    return null;
  } catch {
    return null;
  }
}
