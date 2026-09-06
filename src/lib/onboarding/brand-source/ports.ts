import type { BrandSourceRecord } from "../repository";

export interface BrandSourcePage {
  url: string;
  text: string;
  contentHash: string;
  language: string | null;
}

export interface BrandSourceReadResult {
  finalUrl: string | null;
  cleanedText: string;
  contentHash: string;
  sourceLanguage: string | null;
  extractedBytes: number;
  pages: BrandSourcePage[];
  fetchedAt: Date;
}

export interface BrandSourceReader {
  read(source: BrandSourceRecord): Promise<BrandSourceReadResult>;
}

export interface DnsAddress {
  address: string;
  family: number;
}

export interface DnsResolver {
  resolve(hostname: string): Promise<DnsAddress[]>;
}

export class BrandSourceReadError extends Error {
  constructor(
    readonly code:
      | "SOURCE_BLOCKED"
      | "SOURCE_INVALID"
      | "SOURCE_TOO_LARGE"
      | "SOURCE_UNAVAILABLE"
      | "SOURCE_UNSUPPORTED",
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BrandSourceReadError";
  }
}

