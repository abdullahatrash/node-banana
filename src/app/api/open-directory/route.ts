import { NextRequest, NextResponse } from "next/server";

/** Local-only route — check env directly to avoid pulling heavy @/lib/storage deps into the bundle */
function isCloudMode() {
  return process.env.STORAGE_BACKEND === "s3" || !!process.env.VERCEL;
}

export async function POST(req: NextRequest) {
    // Guard against cloud deployments where OS commands are not available
    if (isCloudMode()) {
        return NextResponse.json(
            { success: false, error: "This operation is only available in local mode." },
            { status: 501 }
        );
    }

    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const { stat } = await import("fs/promises");
    const path = await import("path");
    const os = await import("os");
    const execFileAsync = promisify(execFile);

    try {
        const body = await req.json();
        const { path: inputPath } = body;

        if (!inputPath || typeof inputPath !== "string") {
            return NextResponse.json(
                { success: false, error: "Path is required" },
                { status: 400 }
            );
        }

        // Normalize and resolve the path to prevent traversal attacks
        const normalizedPath = path.resolve(inputPath);

        // Validate that the path exists and is a directory
        try {
            const stats = await stat(normalizedPath);
            if (!stats.isDirectory()) {
                return NextResponse.json(
                    { success: false, error: "Path is not a directory" },
                    { status: 400 }
                );
            }
        } catch {
            return NextResponse.json(
                { success: false, error: "Directory does not exist" },
                { status: 400 }
            );
        }

        let command = "";
        let args: string[] = [];
        const platform = os.platform();

        switch (platform) {
            case "darwin":
                command = "open";
                args = [normalizedPath];
                break;
            case "win32":
                command = "explorer";
                args = [normalizedPath];
                break;
            case "linux":
                command = "xdg-open";
                args = [normalizedPath];
                break;
            default:
                // Fallback for other Unix-like systems
                command = "xdg-open";
                args = [normalizedPath];
        }

        await execFileAsync(command, args);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Failed to open directory:", error);
        return NextResponse.json(
            { success: false, error: "Failed to open directory" },
            { status: 500 }
        );
    }
}
