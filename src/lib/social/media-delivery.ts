import { createHash } from "node:crypto";
import {
  createPresignedDownload,
  getObjectStreamFromS3,
} from "@/lib/storage";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export interface StableSocialMediaReference {
  resourceKind?: "studio_asset" | "artifact";
  assetId: string;
  assetDigest: string;
  order: number;
  alt?: string;
}

export interface OwnedSocialMediaResource {
  resourceKind: "studio_asset" | "artifact";
  id: string;
  digest: string;
  type: "image" | "video";
  storageKey: string;
}

export interface VerifiedSocialMediaItem {
  type: "image" | "video";
  url: string;
  mimeType: string;
  alt?: string;
}

export class SocialMediaDeliveryIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialMediaDeliveryIntegrityError";
  }
}

type DeliveryDependencies = {
  openObject: typeof getObjectStreamFromS3;
  signObject: typeof createPresignedDownload;
};

const DEFAULT_DEPENDENCIES: DeliveryDependencies = {
  openObject: getObjectStreamFromS3,
  signObject: createPresignedDownload,
};

function canonicalResourceKind(reference: StableSocialMediaReference) {
  return reference.resourceKind ?? "studio_asset";
}

function validateReferenceSet(references: StableSocialMediaReference[]): void {
  const identities = new Set<string>();
  for (const [index, reference] of references.entries()) {
    if (reference.order !== index) {
      throw new SocialMediaDeliveryIntegrityError("Social media references must have contiguous canonical order.");
    }
    if (!SHA256_PATTERN.test(reference.assetDigest)) {
      throw new SocialMediaDeliveryIntegrityError("Social media reference is missing a valid SHA-256 digest.");
    }
    const identity = `${canonicalResourceKind(reference)}:${reference.assetId}`;
    if (identities.has(identity)) {
      throw new SocialMediaDeliveryIntegrityError("A social media resource may be delivered only once per post.");
    }
    identities.add(identity);
  }
}

async function digestObjectBody(body: AsyncIterable<Uint8Array>, expectedLength: number): Promise<string> {
  const hash = createHash("sha256");
  let observedLength = 0;
  for await (const chunk of body) {
    observedLength += chunk.byteLength;
    if (observedLength > expectedLength) {
      throw new SocialMediaDeliveryIntegrityError("Stored social media exceeded its asserted byte length.");
    }
    hash.update(chunk);
  }
  if (observedLength !== expectedLength) {
    throw new SocialMediaDeliveryIntegrityError("Stored social media byte length changed during verification.");
  }
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Resolves provider media exclusively from Workspace-owned stable references.
 * The object is streamed and hashed immediately before a fresh delivery URL is
 * minted, so caller-provided preview URLs never cross the provider boundary.
 */
export async function verifyAndResolveSocialMediaDelivery(
  input: {
    references: StableSocialMediaReference[];
    resources: ReadonlyMap<string, OwnedSocialMediaResource>;
  },
  dependencies: DeliveryDependencies = DEFAULT_DEPENDENCIES,
): Promise<VerifiedSocialMediaItem[]> {
  validateReferenceSet(input.references);

  const results: VerifiedSocialMediaItem[] = [];
  for (const reference of input.references) {
    const resourceKind = canonicalResourceKind(reference);
    const resource = input.resources.get(`${resourceKind}:${reference.assetId}`);
    if (!resource || !resource.storageKey) {
      throw new SocialMediaDeliveryIntegrityError("Referenced social media is missing, deleted, or unavailable.");
    }
    if (!SHA256_PATTERN.test(resource.digest) || resource.digest !== reference.assetDigest) {
      throw new SocialMediaDeliveryIntegrityError("Referenced social media digest no longer matches its approved bytes.");
    }

    const object = await dependencies.openObject({ key: resource.storageKey });
    const actualDigest = await digestObjectBody(object.body, object.contentLength);
    if (actualDigest !== reference.assetDigest) {
      throw new SocialMediaDeliveryIntegrityError("Stored social media bytes do not match the approved SHA-256 digest.");
    }

    const signed = await dependencies.signObject({ key: resource.storageKey });
    results.push({
      type: resource.type,
      url: signed.downloadUrl,
      mimeType: object.contentType ?? (resource.type === "video" ? "video/mp4" : "image/jpeg"),
      ...(reference.alt ? { alt: reference.alt } : {}),
    });
  }
  return results;
}
