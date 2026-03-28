import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerAuthSession } from "@/lib/auth/session";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default async function HomePage() {
  const session = await getServerAuthSession(await headers());

  if (session?.user) {
    redirect("/studio");
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
      <div className="fixed top-4 end-4 z-10">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-md border border-neutral-800 bg-neutral-900 rounded-xl p-6">
        <h1 className="text-xl font-semibold">Node Banana</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Sign in to open AI Studio.
        </p>

        <div className="mt-6 flex items-center gap-3">
          <Link
            href="/sign-in"
            className="inline-flex items-center justify-center rounded-md bg-neutral-100 text-neutral-900 px-4 py-2 text-sm font-medium hover:bg-neutral-200"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex items-center justify-center rounded-md border border-neutral-700 text-neutral-100 px-4 py-2 text-sm font-medium hover:border-neutral-500"
          >
            Sign up
          </Link>
        </div>
      </div>
    </main>
  );
}
