import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "@/utils/logger";
import { validateWorkflowPath } from "@/utils/pathValidation";
import { isCloudMode } from "@/lib/storage";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Helper to create S3 client from env vars (used only in cloud mode)
function getCloudStorageClient() {
  return new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
}

function getCloudBucket(): string {
  return process.env.S3_BUCKET_NAME!;
}

export const maxDuration = 300; // 5 minute timeout for large image operations

const IMAGES_FOLDER = "inputs";
const LEGACY_IMAGES_FOLDER = ".images"; // For backward compatibility

// Helper to extract MIME type and extension from data URL
function getMimeAndExtension(dataUrl: string): { mime: string; extension: string } {
  const match = dataUrl.match(/^data:(image\/\w+);base64,/);
  if (match) {
    const mime = match[1];
    const mimeToExt: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
    };
    return { mime, extension: mimeToExt[mime] || "png" };
  }
  // Default to PNG if no MIME type found
  return { mime: "image/png", extension: "png" };
}

// POST: Save an image to the workflow's inputs or generations folder
export async function POST(request: NextRequest) {
  let workflowPath: string | undefined;
  let imageId: string | undefined;
  let folder: string | undefined;
  try {
    const body = await request.json();
    workflowPath = body.workflowPath;
    imageId = body.imageId;
    folder = body.folder || IMAGES_FOLDER; // Default to "inputs"
    const imageData = body.imageData; // Base64 data URL

    // Validate folder is one of the allowed values
    if (folder !== IMAGES_FOLDER && folder !== "generations") {
      folder = IMAGES_FOLDER;
    }

    logger.info('file.save', 'Workflow image save request received', {
      workflowPath,
      imageId,
      folder,
      hasImageData: !!imageData,
    });

    if (!workflowPath || !imageId || !imageData) {
      logger.warn('file.save', 'Workflow image save validation failed: missing fields', {
        hasWorkflowPath: !!workflowPath,
        hasImageId: !!imageId,
        hasImageData: !!imageData,
      });
      return NextResponse.json(
        { success: false, error: "Missing required fields (workflowPath, imageId, imageData)" },
        { status: 400 }
      );
    }

    // Validate path to prevent traversal attacks
    const pathValidation = validateWorkflowPath(workflowPath);
    if (!pathValidation.valid) {
      logger.warn('file.error', 'Workflow image save failed: invalid path', {
        workflowPath,
        error: pathValidation.error,
      });
      return NextResponse.json(
        { success: false, error: pathValidation.error },
        { status: 400 }
      );
    }

    // Validate workflow directory exists, or create it if missing
    try {
      const stats = await fs.stat(workflowPath);
      if (!stats.isDirectory()) {
        logger.warn('file.error', 'Workflow image save failed: path is not a directory', {
          workflowPath,
        });
        return NextResponse.json(
          { success: false, error: "Workflow path is not a directory" },
          { status: 400 }
        );
      }
    } catch (dirError) {
      const err = dirError as NodeJS.ErrnoException;
      const isNotFound =
        err?.code === "ENOENT" ||
        (typeof err?.message === "string" &&
          (err.message.includes("ENOENT") || err.message.includes("no such file or directory")));

      if (!isNotFound) {
        logger.warn('file.error', 'Workflow image save failed: directory validation error', {
          workflowPath,
          error: dirError instanceof Error ? dirError.message : 'Unknown error',
        });
        return NextResponse.json(
          { success: false, error: "Directory validation failed" },
          { status: 400 }
        );
      }

      try {
        await fs.mkdir(workflowPath, { recursive: true });
        logger.info('file.save', 'Created workflow directory for image save', {
          workflowPath,
        });
      } catch (mkdirError) {
        logger.error('file.error', 'Failed to create workflow directory', {
          workflowPath,
        }, mkdirError instanceof Error ? mkdirError : undefined);
        return NextResponse.json(
          { success: false, error: "Failed to create workflow directory" },
          { status: 500 }
        );
      }
    }

    // Create target folder if it doesn't exist
    const targetFolder = path.join(workflowPath, folder);
    try {
      await fs.mkdir(targetFolder, { recursive: true });
    } catch (mkdirError) {
      logger.error('file.error', 'Failed to create target folder', {
        targetFolder,
      }, mkdirError instanceof Error ? mkdirError : undefined);
      return NextResponse.json(
        { success: false, error: "Failed to create target folder" },
        { status: 500 }
      );
    }

    // Sanitize imageId to prevent path traversal
    const safeImageId = path.basename(imageId);
    if (safeImageId !== imageId || imageId.includes('..')) {
      return NextResponse.json(
        { success: false, error: "Invalid imageId" },
        { status: 400 }
      );
    }

    // Cloud mode: upload image directly to R2
    if (isCloudMode()) {
      try {
        const client = getCloudStorageClient();
        const bucket = getCloudBucket();

        const { extension } = getMimeAndExtension(imageData);
        const mimeType = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : `image/${extension}`;

        // Build storage key: workflows/{workflowPath}/{folder}/{imageId}.{ext}
        const storageKey = `workflows/${encodeURIComponent(workflowPath!)}/${folder}/${safeImageId}.${extension}`;

        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");

        await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: storageKey,
          Body: buffer,
          ContentType: mimeType,
        }));

        logger.info('file.save', 'Workflow image saved to R2', {
          storageKey,
          imageId: safeImageId,
          fileSize: buffer.length,
        });

        return NextResponse.json({
          success: true,
          imageId: storageKey, // Return full storage key as imageId for cloud mode
          filePath: storageKey,
        });
      } catch (error) {
        logger.error('file.error', 'Failed to upload workflow image to R2', {
          imageId,
        }, error instanceof Error ? error : undefined);
        return NextResponse.json(
          { success: false, error: "Failed to save image to cloud storage" },
          { status: 500 }
        );
      }
    }

    // Extract MIME type and determine file extension
    const { extension } = getMimeAndExtension(imageData);
    const filename = `${safeImageId}.${extension}`;
    const filePath = path.join(targetFolder, filename);

    // Extract base64 data and convert to buffer
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Write the image file
    await fs.writeFile(filePath, buffer);

    logger.info('file.save', 'Workflow image saved successfully', {
      filePath,
      imageId,
      fileSize: buffer.length,
    });

    return NextResponse.json({
      success: true,
      imageId,
      filePath,
    });
  } catch (error) {
    logger.error('file.error', 'Failed to save workflow image', {
      workflowPath,
      imageId,
    }, error instanceof Error ? error : undefined);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Save failed",
      },
      { status: 500 }
    );
  }
}

// GET: Load an image from the workflow's folders (inputs, generations, or legacy .images)
export async function GET(request: NextRequest) {
  const workflowPath = request.nextUrl.searchParams.get("workflowPath");
  const imageId = request.nextUrl.searchParams.get("imageId");
  const folder = request.nextUrl.searchParams.get("folder"); // Optional hint for which folder to check first

  logger.info('file.load', 'Workflow image load request received', {
    workflowPath,
    imageId,
    folder,
  });

  if (!workflowPath || !imageId) {
    logger.warn('file.load', 'Workflow image load validation failed: missing parameters', {
      hasWorkflowPath: !!workflowPath,
      hasImageId: !!imageId,
    });
    return NextResponse.json(
      { success: false, error: "Missing required parameters (workflowPath, imageId)" },
      { status: 400 }
    );
  }

  try {
    // Validate path to prevent traversal attacks
    const pathValidation = validateWorkflowPath(workflowPath);
    if (!pathValidation.valid) {
      logger.warn('file.error', 'Workflow image load failed: invalid path', {
        workflowPath,
        error: pathValidation.error,
      });
      return NextResponse.json(
        { success: false, error: pathValidation.error },
        { status: 400 }
      );
    }

    // Cloud mode: generate presigned GET URL from R2
    // Note: must come before the local-mode safeImageId check since cloud imageIds
    // are full storage keys (contain slashes) that would fail path.basename comparison
    if (isCloudMode()) {
      try {
        const client = getCloudStorageClient();
        const bucket = getCloudBucket();

        // In cloud mode, imageId is the full R2 storage key
        const storageKey = imageId;

        // Check if object exists
        try {
          await client.send(new HeadObjectCommand({
            Bucket: bucket,
            Key: storageKey,
          }));
        } catch {
          return NextResponse.json({
            success: false,
            error: "Image file not found",
            notFound: true,
          });
        }

        // Generate presigned GET URL (valid for 1 hour)
        const getCommand = new GetObjectCommand({
          Bucket: bucket,
          Key: storageKey,
        });
        const downloadUrl = await getSignedUrl(client, getCommand, { expiresIn: 3600 });

        logger.info('file.load', 'Generated presigned URL for workflow image', {
          storageKey,
          imageId,
        });

        return NextResponse.json({
          success: true,
          imageId,
          downloadUrl,
        });
      } catch (error) {
        logger.error('file.error', 'Failed to generate presigned URL for workflow image', {
          imageId,
        }, error instanceof Error ? error : undefined);
        return NextResponse.json(
          { success: false, error: "Failed to load image from cloud storage" },
          { status: 500 }
        );
      }
    }

    // Sanitize imageId to prevent path traversal (local mode only)
    const safeImageId = path.basename(imageId);
    if (safeImageId !== imageId || imageId.includes('..')) {
      return NextResponse.json(
        { success: false, error: "Invalid imageId" },
        { status: 400 }
      );
    }

    // Validate workflow directory exists
    try {
      const stats = await fs.stat(workflowPath);
      if (!stats.isDirectory()) {
        return NextResponse.json(
          { success: false, error: "Workflow path is not a directory" },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { success: false, error: "Workflow directory does not exist" },
        { status: 400 }
      );
    }

    // Construct file path - check folders and extensions in order
    const possibleExtensions = ["png", "jpg", "jpeg", "gif", "webp"];
    const inputsFolder = path.join(workflowPath, IMAGES_FOLDER);
    const generationsFolder = path.join(workflowPath, "generations");
    const legacyFolder = path.join(workflowPath, LEGACY_IMAGES_FOLDER);

    // Build search order based on folder hint
    const searchOrder = folder === "generations"
      ? [generationsFolder, inputsFolder, legacyFolder]
      : [inputsFolder, generationsFolder, legacyFolder];

    let filePath: string | null = null;
    let foundExtension = "png"; // Track which extension was found

    // Check each folder and extension combination in order
    for (const searchFolder of searchOrder) {
      for (const ext of possibleExtensions) {
        const filename = `${safeImageId}.${ext}`;
        const candidatePath = path.join(searchFolder, filename);
        try {
          await fs.access(candidatePath);
          filePath = candidatePath;
          foundExtension = ext;
          if (searchFolder === legacyFolder) {
            logger.info('file.load', 'Found image in legacy .images folder', { filePath });
          }
          break;
        } catch {
          // File not found with this extension, try next
        }
      }
      if (filePath) break; // Stop searching if file was found
    }

    if (!filePath) {
      // Return 200 with success: false to avoid Next.js error overlay
      // Missing files are expected when workflow refs point to deleted/moved images
      logger.info('file.load', 'Workflow image not found (expected for missing refs)', {
        imageId,
        searchedFolders: searchOrder,
      });
      return NextResponse.json({
        success: false,
        error: "Image file not found",
        notFound: true,
      });
    }

    // Read the image file
    const buffer = await fs.readFile(filePath);

    // Convert to base64 data URL with correct MIME type
    const base64 = buffer.toString("base64");
    const mimeType = foundExtension === "jpg" || foundExtension === "jpeg"
      ? "image/jpeg"
      : `image/${foundExtension}`;
    const dataUrl = `data:${mimeType};base64,${base64}`;

    logger.info('file.load', 'Workflow image loaded successfully', {
      filePath,
      imageId,
      fileSize: buffer.length,
    });

    return NextResponse.json({
      success: true,
      imageId,
      image: dataUrl,
    });
  } catch (error) {
    logger.error('file.error', 'Failed to load workflow image', {
      workflowPath,
      imageId,
    }, error instanceof Error ? error : undefined);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Load failed",
      },
      { status: 500 }
    );
  }
}
