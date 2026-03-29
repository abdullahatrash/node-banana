"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { authClient } from "@/lib/auth/client"
import { setActiveWorkspaceId } from "@/lib/studio/client"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { AppSwitcher } from "@/components/AppSwitcher"

export function HomeHeader() {
  const router = useRouter()
  const { data: session } = authClient.useSession()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleSignOut = async () => {
    setIsSigningOut(true)
    try {
      const result = await authClient.signOut()
      const signOutError =
        result &&
        typeof result === "object" &&
        "error" in result
          ? (result as { error?: unknown }).error
          : null
      if (signOutError) {
        throw signOutError
      }
      setActiveWorkspaceId(null)
      router.refresh()
    } catch (error) {
      console.error("Failed to sign out:", error)
    } finally {
      setIsSigningOut(false)
    }
  }

  const sessionLabel =
    (typeof session?.user?.name === "string" && session.user.name.trim()) ||
    (typeof session?.user?.email === "string" && session.user.email.trim()) ||
    "Signed in"

  return (
    <header className="h-11 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-4 shrink-0 sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <AppSwitcher>
          <div className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer">
            <img src="/logo-node.svg" alt="Tasmeemai" className="w-12 h-12" />
            <span className="text-2xl font-semibold text-neutral-100 tracking-tight">
              Tasmeemai
            </span>
          </div>
        </AppSwitcher>
      </div>

      <div className="flex items-center gap-3 text-xs">
        <LanguageSwitcher className="text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800" />
        {session?.user ? (
          <>
            <span
              className="text-neutral-300 truncate max-w-[220px]"
              title={sessionLabel}
            >
              {sessionLabel}
            </span>
            <button
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
              className="text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-60"
              title="Sign out"
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </button>
          </>
        ) : (
          <>
            <Link
              href="/sign-in"
              className="text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Sign up
            </Link>
          </>
        )}
      </div>
    </header>
  )
}
