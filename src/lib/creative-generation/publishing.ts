import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { CreativeError } from "./contracts";
import { creativeRevisions } from "./db-schema";
import { assertCreativePublishable } from "./review";

/** Called immediately before social delivery. A media-library thumbnail or
 * copied asset URL is not publication approval. Preserve exact historical
 * approval when a creator edits a later session revision. */
export async function assertCreativeAssetDelivery(workspaceId: string, asset: { id: string; checksum: string | null; metadata: unknown }) {
  const metadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata) ? asset.metadata as Record<string, unknown> : null;
  if (metadata?.creativePlateReviewRequired === true) throw new CreativeError("creative.errors.visualReviewRequired");
  if (metadata?.creativeReviewRequired !== true && typeof metadata?.creativeSessionId !== "string") return;
  if (typeof metadata.creativeSessionId !== "string" || !asset.checksum) throw new CreativeError("creative.errors.publicationReviewRequired");
  const [revision] = await getDb().select({ snapshot: creativeRevisions.snapshot }).from(creativeRevisions).where(and(
    eq(creativeRevisions.workspaceId, workspaceId), eq(creativeRevisions.id, metadata.creativeSessionId),
    sql`${creativeRevisions.snapshot}->'output'->>'assetId' = ${asset.id}`,
    sql`${creativeRevisions.snapshot}->'publicationReview'->>'outputDigest' = ${asset.checksum}`,
  )).orderBy(desc(creativeRevisions.revision)).limit(1);
  if (!revision || revision.snapshot.output?.digest !== asset.checksum) throw new CreativeError("creative.errors.publicationReviewRequired");
  assertCreativePublishable(revision.snapshot);
}
