import { Buffer } from "node:buffer";
import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import type {
  BrandSourcePage,
  BrandSourceReader,
  DnsAddress,
  DnsResolver,
} from "./ports";
import { BrandSourceReadError } from "./ports";
import { assertPublicUrl, normalizeWebsiteUrl, systemDnsResolver } from "./url-policy";
import { detectLanguage, extractHtml, sha256 } from "./extract";

const MAX_REDIRECTS = 3;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;
const MAX_PAGES = 4;
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = "TasmeemBrandBot/1.0 (+https://tasmeem.ai/bot)";

function truncateUtf8(value: string, maximumBytes: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maximumBytes) return value;
  return new TextDecoder("utf-8", { fatal: false })
    .decode(encoded.slice(0, maximumBytes))
    .replace(/\uFFFD$/, "");
}

interface FetchedPage {
  finalUrl: URL;
  body: string;
  contentType: string;
}

export function createPinnedLookup(addresses: DnsAddress[]): LookupFunction {
  if (addresses.length === 0) {
    throw new BrandSourceReadError(
      "SOURCE_BLOCKED",
      "A validated public address is required.",
      false,
    );
  }
  const selected = addresses[0];
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(
        null,
        addresses.map((address) => ({
          address: address.address,
          family: address.family,
        })),
      );
      return;
    }
    callback(null, selected.address, selected.family);
  };
}

async function readBoundedBody(response: Response, maximum: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > maximum) {
    throw new BrandSourceReadError("SOURCE_TOO_LARGE", "Website page is too large.", false);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new BrandSourceReadError("SOURCE_TOO_LARGE", "Website page is too large.", false);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export class WebsiteBrandSourceReader implements BrandSourceReader {
  constructor(
    private readonly resolver: DnsResolver = systemDnsResolver,
    private readonly fetchImplementation?: typeof fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async request(
    url: URL,
    addresses: DnsAddress[],
    init: RequestInit,
  ): Promise<{ response: Response; close: () => Promise<void> }> {
    if (this.fetchImplementation) {
      return {
        response: await this.fetchImplementation(url, init),
        close: async () => undefined,
      };
    }
    const pinnedLookup = createPinnedLookup(addresses);
    const dispatcher = new Agent({ connect: { lookup: pinnedLookup } });
    try {
      const response = await undiciFetch(url, {
        method: init.method,
        redirect: "manual",
        signal: init.signal ?? undefined,
        headers: init.headers,
        dispatcher,
      });
      return {
        response: response as unknown as Response,
        close: () => dispatcher.close(),
      };
    } catch (error) {
      await dispatcher.close();
      throw error;
    }
  }

  private async fetchPage(input: URL, maximumBytes = MAX_PAGE_BYTES): Promise<FetchedPage> {
    let url = new URL(input);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const addresses = await assertPublicUrl(url, this.resolver);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        const request = await this.request(url, addresses, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Accept: "text/html,text/plain;q=0.9",
            "User-Agent": USER_AGENT,
          },
        });
        response = request.response;
        const close = request.close;
        if (response.status >= 300 && response.status < 400) {
          await close();
          if (redirect === MAX_REDIRECTS) {
            throw new BrandSourceReadError(
              "SOURCE_BLOCKED",
              "The website redirected too many times.",
              false,
            );
          }
          const location = response.headers.get("location");
          if (!location) {
            throw new BrandSourceReadError(
              "SOURCE_UNAVAILABLE",
              "The website returned an invalid redirect.",
              true,
            );
          }
          url = normalizeWebsiteUrl(new URL(location, url).toString());
          continue;
        }
        if (!response.ok) {
          await close();
          throw new BrandSourceReadError(
            "SOURCE_UNAVAILABLE",
            `The website returned HTTP ${response.status}.`,
            response.status >= 500 || response.status === 429,
          );
        }
        const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
        if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
          await close();
          throw new BrandSourceReadError(
            "SOURCE_UNSUPPORTED",
            "The website did not return HTML or plain text.",
            false,
          );
        }
        try {
          return {
            finalUrl: url,
            body: await readBoundedBody(response, maximumBytes),
            contentType,
          };
        } finally {
          await close();
        }
      } catch (error) {
        if (error instanceof BrandSourceReadError) throw error;
        throw new BrandSourceReadError(
          "SOURCE_UNAVAILABLE",
          "The website could not be reached.",
          true,
        );
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new BrandSourceReadError("SOURCE_UNAVAILABLE", "Website fetch failed.", true);
  }

  private async isAllowedByRobots(url: URL): Promise<boolean> {
    const robotsUrl = new URL("/robots.txt", url.origin);
    try {
      const robots = await this.fetchPage(robotsUrl, 256 * 1024);
      const lines = robots.body.split(/\r?\n/);
      let relevant = false;
      const rules: Array<{ allow: boolean; path: string }> = [];
      for (const rawLine of lines) {
        const line = rawLine.split("#")[0].trim();
        const separator = line.indexOf(":");
        if (separator < 0) continue;
        const key = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        if (key === "user-agent") {
          relevant = value === "*" || value.toLowerCase() === "tasmeembrandbot";
        } else if (relevant && (key === "allow" || key === "disallow") && value) {
          rules.push({ allow: key === "allow", path: value });
        }
      }
      const matching = rules
        .filter((rule) => url.pathname.startsWith(rule.path))
        .sort((left, right) => right.path.length - left.path.length);
      return matching[0]?.allow ?? true;
    } catch {
      return true;
    }
  }

  async read(source: Parameters<BrandSourceReader["read"]>[0]) {
    if (source.kind !== "website" || !source.submittedUrl) {
      throw new BrandSourceReadError(
        "SOURCE_INVALID",
        "A public website URL is required.",
        false,
      );
    }
    const initialUrl = normalizeWebsiteUrl(source.submittedUrl);
    if (!(await this.isAllowedByRobots(initialUrl))) {
      throw new BrandSourceReadError(
        "SOURCE_BLOCKED",
        "The website does not permit this page to be read.",
        false,
      );
    }

    const home = await this.fetchPage(initialUrl);
    const extractedHome = home.contentType.includes("text/html")
      ? extractHtml(home.body, home.finalUrl)
      : {
          text: home.body.replace(/\s+/g, " ").trim(),
          language: detectLanguage(home.body),
          links: [],
        };
    if (!extractedHome.text) {
      throw new BrandSourceReadError(
        "SOURCE_UNAVAILABLE",
        "No readable company information was found on the page.",
        true,
      );
    }

    const pages: BrandSourcePage[] = [
      {
        url: home.finalUrl.toString(),
        text: extractedHome.text,
        contentHash: sha256(extractedHome.text),
        language: extractedHome.language,
      },
    ];
    let totalBytes = Buffer.byteLength(extractedHome.text);
    for (const link of extractedHome.links.slice(0, MAX_PAGES - 1)) {
      if (totalBytes >= MAX_TOTAL_BYTES) break;
      const candidate = normalizeWebsiteUrl(link);
      if (candidate.origin !== home.finalUrl.origin) continue;
      if (!(await this.isAllowedByRobots(candidate))) continue;
      try {
        const fetched = await this.fetchPage(
          candidate,
          Math.min(MAX_PAGE_BYTES, MAX_TOTAL_BYTES - totalBytes),
        );
        const extracted = fetched.contentType.includes("text/html")
          ? extractHtml(fetched.body, fetched.finalUrl)
          : {
              text: fetched.body.replace(/\s+/g, " ").trim(),
              language: detectLanguage(fetched.body),
            };
        if (!extracted.text) continue;
        const bytes = Buffer.byteLength(extracted.text);
        totalBytes += bytes;
        pages.push({
          url: fetched.finalUrl.toString(),
          text: extracted.text,
          contentHash: sha256(extracted.text),
          language: extracted.language,
        });
      } catch (error) {
        if (error instanceof BrandSourceReadError && !error.retryable) throw error;
        // Optional high-signal pages may fail without invalidating the homepage.
      }
    }

    const cleanedText = truncateUtf8(
      pages.map((page) => `[Source: ${page.url}]\n${page.text}`).join("\n\n"),
      MAX_TOTAL_BYTES,
    );
    const languages = pages.map((page) => page.language).filter(Boolean);
    const sourceLanguage = languages[0] ?? detectLanguage(cleanedText);
    return {
      finalUrl: home.finalUrl.toString(),
      cleanedText,
      contentHash: sha256(cleanedText),
      sourceLanguage,
      extractedBytes: Buffer.byteLength(cleanedText),
      pages,
      fetchedAt: this.now(),
    };
  }
}
