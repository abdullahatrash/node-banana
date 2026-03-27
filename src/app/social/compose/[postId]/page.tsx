import { EditDraftClient } from "@/components/social/compose/EditDraftClient"

interface EditDraftPageProps {
  params: Promise<{ postId: string }>
}

export default async function EditDraftPage({ params }: EditDraftPageProps) {
  const { postId } = await params
  // Data fetching happens client-side via the social client (requires workspace header).
  // Server-side fetch would need auth context forwarding which isn't set up yet.
  // Pass postId as prop — client component handles the fetch with proper auth.
  return <EditDraftClient postId={postId} />
}
