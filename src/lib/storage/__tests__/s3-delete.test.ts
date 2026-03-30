import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSend = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = mockSend;
  },
  DeleteObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
}));

describe("deleteObjectFromS3", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.stubEnv("S3_BUCKET_NAME", "test-bucket");
    vi.stubEnv("S3_REGION", "auto");
    vi.stubEnv("S3_ACCESS_KEY_ID", "test-key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret");
  });

  it("calls DeleteObjectCommand with correct bucket and key", async () => {
    const { deleteObjectFromS3 } = await import("../s3");
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");

    await deleteObjectFromS3({ key: "env/prod/ws/ws_1/test.png" });

    expect(DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "env/prod/ws/ws_1/test.png",
    });
    expect(mockSend).toHaveBeenCalled();
  });

  it("throws when S3 config is missing", async () => {
    vi.stubEnv("S3_BUCKET_NAME", "");
    const { deleteObjectFromS3 } = await import("../s3");

    await expect(
      deleteObjectFromS3({ key: "some-key" }),
    ).rejects.toThrow("Missing S3 configuration");
  });
});
