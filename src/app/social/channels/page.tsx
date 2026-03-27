import { ChannelsPageClient } from "@/components/social/ChannelsPageClient"

interface ChannelsPageProps {
  searchParams: Promise<{
    code?: string
    state?: string
    platform?: string
    oauth_token?: string
    oauth_verifier?: string
  }>
}

export default async function ChannelsPage({ searchParams }: ChannelsPageProps) {
  const params = await searchParams

  // Normalize OAuth callback params (X uses oauth_token/oauth_verifier)
  const oauthCallback =
    (params.code && params.state) || (params.oauth_token && params.oauth_verifier)
      ? {
          platform: params.platform ?? "",
          code: params.code ?? params.oauth_verifier ?? "",
          state: params.state ?? params.oauth_token ?? "",
        }
      : null

  return <ChannelsPageClient oauthCallback={oauthCallback} />
}
