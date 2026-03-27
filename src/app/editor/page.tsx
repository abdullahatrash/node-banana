import Link from "next/link";

export default function EditorUpgradePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">Video Editor</h1>
        <p className="mt-2 text-neutral-400">
          The video editor is available on Pro plans.
        </p>
        <Link
          href="/studio"
          className="mt-4 inline-block rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
        >
          Back to Studio
        </Link>
      </div>
    </div>
  );
}
