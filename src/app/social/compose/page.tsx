import { ComposePageClient } from "@/components/social/compose/ComposePageClient"

interface ComposePageProps {
  searchParams: Promise<{ date?: string }>
}

export default async function ComposePage({ searchParams }: ComposePageProps) {
  const params = await searchParams
  return <ComposePageClient initialDate={params.date ?? null} />
}
