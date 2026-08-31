import Link from "next/link"
import { headers } from "next/headers"
import { getServerAuthSession } from "@/lib/auth/session"
import { HomeHeader } from "@/components/HomeHeader"
import { HomeFooter } from "@/components/HomeFooter"

export default async function HomePage() {
  const session = await getServerAuthSession(await headers())

  return (
    <div className="min-h-screen flex flex-col bg-neutral-900 text-neutral-100">
      <HomeHeader />

      <main className="flex-1 flex items-center justify-center px-6 md:px-12">
        <div className="flex flex-col md:flex-row items-center gap-12 max-w-5xl w-full">
          {/* Left: text + CTAs */}
          <div className="flex-1 flex flex-col items-start gap-6">
            <h2 className="text-5xl md:text-6xl font-bold tracking-tight">
              Tasmeemai
            </h2>
            <p className="text-lg text-neutral-400 max-w-md">
              Arabic-first content creation and publishing for MENA brands
            </p>
            <div className="flex items-center gap-3">
              <Link
                href="/simple-studio/images"
                className="inline-flex items-center justify-center rounded-md bg-neutral-100 text-neutral-900 px-5 py-2.5 text-sm font-medium hover:bg-neutral-200 transition-colors"
              >
                Open Content Studio
              </Link>
              {!session?.user && (
                <Link
                  href="/sign-in"
                  className="inline-flex items-center justify-center rounded-md border border-neutral-700 text-neutral-100 px-5 py-2.5 text-sm font-medium hover:border-neutral-500 transition-colors"
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>

          {/* Right: hero image */}
          <div className="flex-1 flex justify-center">
            <img
              src="/hero-horse.png"
              alt="Tasmeemai"
              className="w-full max-w-[600px] h-auto object-contain"
              draggable={false}
            />
          </div>
        </div>
      </main>

      <HomeFooter />
    </div>
  )
}
