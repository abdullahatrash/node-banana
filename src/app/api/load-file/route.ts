import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
import os from "os";
import { isCloudMode } from "@/lib/storage";

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  obj: "model/obj",
  usdz: "model/vnd.usdz+zip",
  fbx: "model/fbx",
  stl: "model/stl",
};

function isLocalhostRequest(req: NextRequest): boolean {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0]?.trim();
    if (
      firstIp &&
      firstIp !== "127.0.0.1" &&
      firstIp !== "::1" &&
      firstIp !== "::ffff:127.0.0.1"
    ) {
      return false;
    }
  }

  const host = req.headers.get("host") || "";
  const hostname = host.split(":")[0];
  if (
    hostname &&
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "::1"
  ) {
    return false;
  }

  return true;
}

function getMimeTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  return EXT_TO_MIME[ext] || "application/octet-stream";
}

export async function POST(request: NextRequest) {
  if (isCloudMode()) {
    return NextResponse.json(
      { success: false, error: "This operation is only available in local mode." },
      { status: 501 },
    );
  }

  if (!isLocalhostRequest(request)) {
    return NextResponse.json(
      { success: false, error: "Forbidden: localhost only" },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json()) as { filePath?: unknown };
    if (typeof body.filePath !== "string" || !body.filePath.trim()) {
      return NextResponse.json(
        { success: false, error: "filePath is required." },
        { status: 400 },
      );
    }

    const normalizedPath = path.resolve(body.filePath);
    const homeDir = os.homedir();
    if (
      !normalizedPath.startsWith(`${homeDir}${path.sep}`) &&
      normalizedPath !== homeDir
    ) {
      return NextResponse.json(
        { success: false, error: "Path is outside allowed directory" },
        { status: 403 },
      );
    }

    const fileStats = await stat(normalizedPath);
    if (!fileStats.isFile()) {
      return NextResponse.json(
        { success: false, error: "Path is not a file" },
        { status: 400 },
      );
    }

    const buffer = await readFile(normalizedPath);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": getMimeTypeForPath(normalizedPath),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("ENOENT")
        ? "File does not exist"
        : "Failed to load file";
    return NextResponse.json(
      { success: false, error: message },
      { status: message === "File does not exist" ? 400 : 500 },
    );
  }
}
