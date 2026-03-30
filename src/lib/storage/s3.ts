import { randomUUID } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

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

export interface PresignedDownloadResult {
  key: string;
  downloadUrl: string;
  expiresInSeconds: number;
}

export async function putObjectToS3(params: {
  key: string;
  body: Uint8Array | Buffer;
  contentType: string;
}): Promise<void> {
  const config = getS3ConfigFromEnv();
  const client = createS3Client(config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    }),
  );
}

export async function objectExistsInS3(params: { key: string }): Promise<boolean> {
  const config = getS3ConfigFromEnv();
  const client = createS3Client(config);
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: params.key,
      }),
    );
    return true;
  } catch {
    return false;
  }
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

function sanitizeKeySegment(value: string | null | undefined, fallback: string): string {
  const normalized = (value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

export function buildAssetObjectKey(params: {
  workspaceId: string;
  projectId?: string | null;
  assetType: string;
  fileExtension?: string;
}) {
  const environment = sanitizeKeySegment(
    process.env.STORAGE_ENV ||
      process.env.VERCEL_ENV ||
      process.env.NODE_ENV ||
      "development",
    "development",
  );
  const workspaceSegment = sanitizeKeySegment(params.workspaceId, "workspace");
  const projectSegment = sanitizeKeySegment(params.projectId || "unscoped", "unscoped");
  const typeSegment = sanitizeKeySegment(params.assetType, "asset");
  const ext = sanitizeKeySegment(params.fileExtension?.replace(/^\./, "") || "bin", "bin");
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `env/${environment}/ws/${workspaceSegment}/proj/${projectSegment}/${typeSegment}/${year}/${month}/${day}/${Date.now()}-${randomUUID()}.${ext}`;
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

export async function createPresignedDownload(params: {
  key: string;
  expiresInSeconds?: number;
}): Promise<PresignedDownloadResult> {
  const config = getS3ConfigFromEnv();
  const client = createS3Client(config);
  const expiresInSeconds = params.expiresInSeconds ?? 900;
  const getCommand = new GetObjectCommand({
    Bucket: config.bucket,
    Key: params.key,
  });
  const downloadUrl = await getSignedUrl(client, getCommand, {
    expiresIn: expiresInSeconds,
  });

  return {
    key: params.key,
    downloadUrl,
    expiresInSeconds,
  };
}

export async function getObjectFromS3(params: {
  key: string;
}): Promise<{ body: Buffer; contentType: string | null }> {
  const config = getS3ConfigFromEnv();
  const client = createS3Client(config);
  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: params.key,
    }),
  );
  const bytes = await response.Body?.transformToByteArray();
  if (!bytes) throw new Error("Empty response body from S3");
  return {
    body: Buffer.from(bytes),
    contentType: response.ContentType ?? null,
  };
}

export async function deleteObjectFromS3(params: { key: string }): Promise<void> {
  const config = getS3ConfigFromEnv();
  const client = createS3Client(config);
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: params.key,
    }),
  );
}

export async function streamUploadToS3(params: {
  key: string;
  body: ReadableStream<Uint8Array> | NodeJS.ReadableStream;
  contentType: string;
  contentLength?: number;
}): Promise<{ sizeBytes: number }> {
  const config = getS3ConfigFromEnv();
  const client = createS3Client(config);

  // Convert web ReadableStream to Node.js Readable if needed
  const nodeStream =
    params.body instanceof Readable
      ? params.body
      : Readable.fromWeb(params.body as import("node:stream/web").ReadableStream);

  let sizeBytes = 0;
  const countingStream = new Readable({
    read() {
      // no-op — data is pushed from the pipe
    },
  });

  nodeStream.on("data", (chunk: Buffer | Uint8Array) => {
    sizeBytes += chunk.length;
    countingStream.push(chunk);
  });
  nodeStream.on("end", () => {
    countingStream.push(null);
  });
  nodeStream.on("error", (err) => {
    countingStream.destroy(err);
  });

  const upload = new Upload({
    client,
    params: {
      Bucket: config.bucket,
      Key: params.key,
      Body: countingStream,
      ContentType: params.contentType,
      ...(params.contentLength != null ? { ContentLength: params.contentLength } : {}),
    },
    partSize: 10 * 1024 * 1024, // 10 MB
    queueSize: 2,
  });

  await upload.done();

  return { sizeBytes };
}

export function buildCdnDownloadUrl(params: { key: string }): string | null {
  const cdnBaseUrl = process.env.CDN_BASE_URL;
  if (!cdnBaseUrl) return null;
  const base = cdnBaseUrl.replace(/\/+$/, "");
  return `${base}/${params.key}`;
}

export async function createMultipartUpload(params: {
  key: string;
  contentType: string;
}): Promise<{ uploadId: string; key: string }> {
  const config = getS3ConfigFromEnv();
  const client = createS3Client(config);
  const result = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: config.bucket,
      Key: params.key,
      ContentType: params.contentType,
    }),
  );
  if (!result.UploadId) {
    throw new Error("Failed to initiate multipart upload: no UploadId returned.");
  }
  return { uploadId: result.UploadId, key: params.key };
}

export async function presignUploadPart(params: {
  key: string;
  uploadId: string;
  partNumber: number;
  expiresInSeconds?: number;
}): Promise<{ uploadUrl: string; partNumber: number }> {
  const config = getS3ConfigFromEnv();
  const client = createS3Client(config);
  const expiresInSeconds = params.expiresInSeconds ?? 900;
  const command = new UploadPartCommand({
    Bucket: config.bucket,
    Key: params.key,
    UploadId: params.uploadId,
    PartNumber: params.partNumber,
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  return { uploadUrl, partNumber: params.partNumber };
}

export async function completeMultipartUpload(params: {
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; eTag: string }>;
}): Promise<void> {
  const config = getS3ConfigFromEnv();
  const client = createS3Client(config);
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: config.bucket,
      Key: params.key,
      UploadId: params.uploadId,
      MultipartUpload: {
        Parts: params.parts.map((p) => ({
          PartNumber: p.partNumber,
          ETag: p.eTag,
        })),
      },
    }),
  );
}

export async function abortMultipartUpload(params: {
  key: string;
  uploadId: string;
}): Promise<void> {
  const config = getS3ConfigFromEnv();
  const client = createS3Client(config);
  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: config.bucket,
      Key: params.key,
      UploadId: params.uploadId,
    }),
  );
}

export async function listObjectsInS3(params: {
  prefix: string;
  maxKeys?: number;
  continuationToken?: string;
}): Promise<{ keys: string[]; nextContinuationToken?: string }> {
  const config = getS3ConfigFromEnv();
  const client = createS3Client(config);
  const result = await client.send(
    new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: params.prefix,
      MaxKeys: params.maxKeys ?? 1000,
      ContinuationToken: params.continuationToken,
    }),
  );
  const keys = (result.Contents ?? [])
    .map((obj) => obj.Key)
    .filter((key): key is string => Boolean(key));
  return {
    keys,
    nextContinuationToken: result.NextContinuationToken ?? undefined,
  };
}

export async function copyObjectInS3(params: {
  sourceKey: string;
  destinationKey: string;
}): Promise<void> {
  const config = getS3ConfigFromEnv();
  const client = createS3Client(config);
  await client.send(
    new CopyObjectCommand({
      Bucket: config.bucket,
      CopySource: `${config.bucket}/${params.sourceKey}`,
      Key: params.destinationKey,
    }),
  );
}

export function isS3Configured(): boolean {
  return Boolean(
    process.env.S3_BUCKET_NAME &&
      process.env.S3_REGION &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY,
  );
}
