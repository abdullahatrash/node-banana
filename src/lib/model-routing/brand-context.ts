import { and, eq, isNull } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import type { BrandProfileV1 } from "@/lib/onboarding/schemas";
import { createPresignedDownload } from "@/lib/storage";
import type { ImmutableBrandContext } from "./types";

const clean = (value: string) => value.normalize("NFKC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
const cleanList = (values: string[]) => values.map(clean).filter(Boolean);

export type LoadedBrandContext = { context: ImmutableBrandContext; referenceUrls: Array<{ assetId: string; url: string }> };

/** Builds an immutable data-only Brand Context. User text is never concatenated into instructions. */
export async function loadImmutableBrandContext(input: { workspaceId: string; profileId: string; revision: number; acceptedAt: Date; profile: BrandProfileV1 }): Promise<LoadedBrandContext | null> {
  const referenceAssets: ImmutableBrandContext["referenceAssets"] = [];
  const referenceUrls: LoadedBrandContext["referenceUrls"] = [];
  if (input.profile.identity.logoAssetId) {
    const [logo] = await getDb().select({ id: assets.id, type: assets.type, storageKey: assets.storageKey, checksum: assets.checksum, metadata: assets.metadata }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.id, input.profile.identity.logoAssetId), isNull(assets.deletedAt))).limit(1);
    const ready = logo && logo.type === "image" && logo.storageKey && /^sha256:[a-f0-9]{64}$/.test(logo.checksum ?? "") && logo.metadata && typeof logo.metadata === "object" && !Array.isArray(logo.metadata) && logo.metadata.uploadState === "ready";
    if (!ready) return null;
    referenceAssets.push({ assetId: logo.id, digest: logo.checksum as `sha256:${string}`, kind: "logo" });
    referenceUrls.push({ assetId: logo.id, url: (await createPresignedDownload({ key: logo.storageKey! })).downloadUrl });
  }
  const value: Omit<ImmutableBrandContext, "digest"> = {
    schema: "brand-context/v1" as const,
    profileId: input.profileId,
    revision: input.revision,
    acceptedAt: input.acceptedAt,
    contentLanguage: input.profile.contentLanguage === "ar" || input.profile.contentLanguage === "en" ? input.profile.contentLanguage : "mixed",
    identity: { companyName: clean(input.profile.identity.companyName), coreIdentity: clean(input.profile.identity.coreIdentity) },
    offering: cleanList(input.profile.offering),
    audiences: input.profile.audiences.map((audience) => ({ name: clean(audience.name), description: clean(audience.description), weight: audience.weight })),
    benefits: cleanList(input.profile.benefits),
    differentiators: cleanList(input.profile.differentiators),
    positioning: clean(input.profile.positioning),
    voice: { descriptors: cleanList(input.profile.voice.descriptors), do: cleanList(input.profile.voice.do), doNot: cleanList(input.profile.voice.doNot) },
    palette: [] as string[],
    constraints: { prohibitedClaims: cleanList(input.profile.prohibitedClaims), prohibitedTopics: cleanList(input.profile.prohibitedTopics) },
    contentAngles: cleanList(input.profile.contentAngles),
    referenceAssets,
  };
  return { context: { ...value, digest: canonicalDigest(value) as `sha256:${string}` }, referenceUrls };
}

export function validateImmutableBrandContext(context: ImmutableBrandContext): boolean {
  const { digest, ...value } = context;
  return context.schema === "brand-context/v1" && context.revision > 0 && context.identity.companyName.length > 0 && /^sha256:[a-f0-9]{64}$/.test(digest) && canonicalDigest(value) === digest;
}
