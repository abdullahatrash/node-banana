import { Buffer } from "node:buffer";
import type { BrandSourceReader } from "./ports";
import { BrandSourceReadError } from "./ports";
import { detectLanguage, sha256 } from "./extract";

export class DescriptionBrandSourceReader implements BrandSourceReader {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async read(source: Parameters<BrandSourceReader["read"]>[0]) {
    if (source.kind !== "description" || !source.submittedDescription) {
      throw new BrandSourceReadError(
        "SOURCE_INVALID",
        "A company description is required.",
        false,
      );
    }
    const cleanedText = source.submittedDescription.replace(/\s+/g, " ").trim();
    if (cleanedText.length < 20 || cleanedText.length > 50_000) {
      throw new BrandSourceReadError(
        "SOURCE_INVALID",
        "Company description must contain 20 to 50,000 characters.",
        false,
      );
    }
    const contentHash = sha256(cleanedText);
    const sourceLanguage = detectLanguage(cleanedText);
    const fetchedAt = this.now();
    return {
      finalUrl: null,
      cleanedText,
      contentHash,
      sourceLanguage,
      extractedBytes: Buffer.byteLength(cleanedText),
      pages: [
        {
          url: `description://${source.id}`,
          text: cleanedText,
          contentHash,
          language: sourceLanguage,
        },
      ],
      fetchedAt,
    };
  }
}

