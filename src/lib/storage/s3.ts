import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface PresignedUploadResult {
  key: string;
  uploadUrl: string;
  downloadUrl: string;
  expiresInSeconds: number;
}

function getS3ConfigFromEnv(): S3StorageConfig {
  const bucket = process.env.S3_BUCKET_NAME;
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing S3 configuration. Set S3_BUCKET_NAME, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.",
    );
  }

  return {
    bucket,
    region,
    endpoint: process.env.S3_ENDPOINT || undefined,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  };
}

function createS3Client(config: S3StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function buildAssetObjectKey(params: {
  workspaceId: string;
  projectId?: string | null;
  assetType: string;
  fileExtension?: string;
}) {
  const ext = params.fileExtension?.replace(/^\./, "") || "bin";
  const projectSegment = params.projectId || "unscoped";
  return `${params.workspaceId}/${projectSegment}/${params.assetType}/${Date.now()}-${randomUUID()}.${ext}`;
}

export async function createPresignedUpload(params: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<PresignedUploadResult> {
  const config = getS3ConfigFromEnv();
  const client = createS3Client(config);
  const expiresInSeconds = params.expiresInSeconds ?? 900;

  const putCommand = new PutObjectCommand({
    Bucket: config.bucket,
    Key: params.key,
    ContentType: params.contentType,
  });

  const getCommand = new GetObjectCommand({
    Bucket: config.bucket,
    Key: params.key,
  });

  const [uploadUrl, downloadUrl] = await Promise.all([
    getSignedUrl(client, putCommand, { expiresIn: expiresInSeconds }),
    getSignedUrl(client, getCommand, { expiresIn: expiresInSeconds }),
  ]);

  return {
    key: params.key,
    uploadUrl,
    downloadUrl,
    expiresInSeconds,
  };
}

export function isS3Configured(): boolean {
  return Boolean(
    process.env.S3_BUCKET_NAME &&
      process.env.S3_REGION &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY,
  );
}

