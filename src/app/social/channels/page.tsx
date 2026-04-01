import { cookies } from "next/headers"
import { ChannelsPageClient } from "@/components/social/ChannelsPageClient"

const OAUTH_CALLBACK_COOKIE = "social_oauth_cb"

interface ChannelsPageProps {
  searchParams: Promise<{
    oauth_pending?: string
    error?: string
  }>
}

export default async function ChannelsPage({ searchParams }: ChannelsPageProps) {
  const params = await searchParams
  const cookieStore = await cookies()

  // Read OAuth callback data from the secure HTTP-only cookie set by the
  // GET callback handler, then clear it immediately.
  let oauthCallback: { platform: string; code: string; state: string } | null = null
  const callbackCookie = cookieStore.get(OAUTH_CALLBACK_COOKIE)
  if (callbackCookie) {
    try {
      const parsed = JSON.parse(callbackCookie.value)
      if (parsed.platform && parsed.code && parsed.state) {
        oauthCallback = parsed
      }
    } catch {
      // Malformed cookie — ignore
    }
  }

  return (
    <ChannelsPageClient
      oauthCallback={oauthCallback}
      oauthError={params.error ?? null}
      clearCallbackCookie={!!callbackCookie}
    />
  )
}
