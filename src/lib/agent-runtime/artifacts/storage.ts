import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  copyObjectInS3,
  createPresignedDownload,
  createPresignedUpload,
  deleteObjectFromS3,
  getObjectStreamFromS3,
  putObjectToS3,
} from "@/lib/storage";
import type {
  ArtifactContentStore,
  ArtifactMediaInspector,
} from "./types";

const SUPPORTED_IMAGE_MEDIA = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
} as const;

export function artifactContentObjectKey(
  workspaceId: string,
  digest: string,
): string {
  const workspaceDigest = createHash("sha256")
    .update(workspaceId, "utf8")
    .digest("hex");
  return `agent-artifacts/content/${workspaceDigest}/${digest.slice(7)}`;
}

/**
 * Presigned staging PUTs can be replayed until they expire. Deployments must
 * therefore configure a bucket lifecycle rule that removes every object under
 * `agent-artifacts/staging/` within at most 24 hours.
 */
export function assertArtifactStagingLifecycleConfigured(
  value = process.env.S3_ARTIFACT_STAGING_LIFECYCLE_MAX_HOURS,
): number {
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) {
    throw new Error(
      "S3_ARTIFACT_STAGING_LIFECYCLE_MAX_HOURS must confirm a 1-24 hour lifecycle rule for agent-artifacts/staging/.",
    );
  }
  return hours;
}

export class S3ArtifactContentStore implements ArtifactContentStore {
  async createUploadHandoff(
    input: Parameters<ArtifactContentStore["createUploadHandoff"]>[0],
  ) {
    assertArtifactStagingLifecycleConfigured();
    const signed = await createPresignedUpload({
      key: input.stagingKey,
      contentType: input.mediaType,
      contentLength: input.contentLength,
      expiresInSeconds: input.expiresInSeconds,
    });
    return {
      uploadUrl: signed.uploadUrl,
      expiresAt: new Date(
        input.now.getTime() + input.expiresInSeconds * 1_000,
      ),
    };
  }

  async readStaged(
    input: Parameters<ArtifactContentStore["readStaged"]>[0],
  ) {
    const snapshot = await getObjectStreamFromS3({ key: input.stagingKey });
    return {
      chunks: snapshot.body,
      mediaType: snapshot.contentType,
      sourceIdentity: {
        versionId: snapshot.versionId,
        etag: snapshot.etag,
        contentLength: snapshot.contentLength,
      },
    };
  }

  async promoteStaged(
    input: Parameters<ArtifactContentStore["promoteStaged"]>[0],
  ) {
    const storageKey = artifactContentObjectKey(
      input.workspaceId,
      input.digest,
    );
    // Promotion is bound to the exact VersionId and ETag observed during
    // verification, so a replayed staging PUT cannot replace the verified
    // bytes. Content addressing safely converges concurrent identical imports.
    await copyObjectInS3({
      sourceKey: input.stagingKey,
      destinationKey: storageKey,
      sourceVersionId: input.sourceIdentity.versionId,
      sourceETag: input.sourceIdentity.etag,
    });
    return { storageKey };
  }

  async writeGenerated(
    input: Parameters<ArtifactContentStore["writeGenerated"]>[0],
  ) {
    const observedDigest = `sha256:${createHash("sha256")
      .update(input.bytes)
      .digest("hex")}`;
    if (observedDigest !== input.digest) {
      throw new Error("Generated Artifact digest mismatch.");
    }
    const storageKey = artifactContentObjectKey(
      input.workspaceId,
      input.digest,
    );
    // The service verifies the bytes before this boundary. A digest-addressed
    // PUT makes retries and concurrent identical settlements converge on the
    // same immutable object key.
    await putObjectToS3({
      key: storageKey,
      body: input.bytes,
      contentType: input.mediaType,
    });
    return { storageKey };
  }

  async createDownloadHandoff(
    input: Parameters<ArtifactContentStore["createDownloadHandoff"]>[0],
  ) {
    const signed = await createPresignedDownload({
      key: input.storageKey,
      expiresInSeconds: input.expiresInSeconds,
    });
    return {
      downloadUrl: signed.downloadUrl,
      expiresAt: new Date(
        input.now.getTime() + input.expiresInSeconds * 1_000,
      ),
    };
  }

  deleteStaged(
    input: Parameters<ArtifactContentStore["deleteStaged"]>[0],
  ): Promise<void> {
    return deleteObjectFromS3({ key: input.stagingKey });
  }
}

export class SharpArtifactMediaInspector implements ArtifactMediaInspector {
  async inspectImage(bytes: Uint8Array) {
    const metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: 100_000_000,
      animated: false,
    }).metadata();
    const mediaType = metadata.format
      ? SUPPORTED_IMAGE_MEDIA[
          metadata.format as keyof typeof SUPPORTED_IMAGE_MEDIA
        ]
      : undefined;
    if (
      !mediaType ||
      !metadata.width ||
      !metadata.height ||
      metadata.width <= 0 ||
      metadata.height <= 0
    ) {
      throw new Error("Unsupported Artifact image.");
    }
    return {
      mediaType,
      width: metadata.width,
      height: metadata.height,
    };
  }
}
