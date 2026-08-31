import Link from "next/link";

export default function EditorCatchAll() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">Video Editor</h1>
        <p className="mt-2 text-neutral-400">
          The video editor is not available in this environment.
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          Start the OpenCut editor service or use the microfrontend proxy.
        </p>
        <Link
          href="/simple-studio/videos"
          className="mt-4 inline-block rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
        >
          Back to Content Studio
        </Link>
      </div>
    </div>
  );
}
