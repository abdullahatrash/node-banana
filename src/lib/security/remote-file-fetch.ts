import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { isIP, type LookupFunction } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, fetch as undiciFetch } from "undici";

export interface PublicDnsAddress {
  address: string;
  family: number;
}

export interface PublicDnsResolver {
  resolve(hostname: string): Promise<PublicDnsAddress[]>;
}

export type RemoteFileFetchCode =
  | "REMOTE_URL_INVALID"
  | "REMOTE_URL_BLOCKED"
  | "REMOTE_REDIRECT_LIMIT"
  | "REMOTE_HTTP_ERROR"
  | "REMOTE_BODY_MISSING"
  | "REMOTE_FILE_EMPTY"
  | "REMOTE_FILE_TOO_LARGE"
  | "REMOTE_FETCH_TIMEOUT"
  | "REMOTE_FETCH_UNAVAILABLE";

export class RemoteFileFetchError extends Error {
  constructor(readonly code: RemoteFileFetchCode) {
    super(code);
    this.name = "RemoteFileFetchError";
  }
}

export const systemPublicDnsResolver: PublicDnsResolver = {
  resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
};

function ipv4Number(address: string): number | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}

function inV4Range(value: number, base: string, prefix: number): boolean {
  const baseValue = ipv4Number(base);
  if (baseValue === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === null) return false;
  const blocked: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];
  return !blocked.some(([base, prefix]) => inV4Range(value, base, prefix));
}

function expandIpv6(address: string): number[] | null {
  let normalized = address.toLowerCase().split("%")[0]!;
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = ipv4Number(normalized.slice(lastColon + 1));
    if (ipv4 === null) return null;
    normalized = `${normalized.slice(0, lastColon)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...right]
    .map((group) => Number.parseInt(group || "0", 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? groups
    : null;
}

function isPublicIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups || groups.every((group) => group === 0)) return false;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return false;
  if ((groups[0]! & 0xe000) !== 0x2000) return false;
  if ((groups[0]! & 0xfe00) === 0xfc00 || (groups[0]! & 0xffc0) === 0xfe80 || (groups[0]! & 0xff00) === 0xff00) return false;
  if ((groups[0] === 0x2001 && groups[1] === 0x0db8) || (groups[0] === 0x2001 && groups[1] === 0) || groups[0] === 0x2002) return false;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return isPublicIpv4(`${groups[6]! >>> 8}.${groups[6]! & 0xff}.${groups[7]! >>> 8}.${groups[7]! & 0xff}`);
  }
  return true;
}

export function isPublicRemoteAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export function normalizeRemoteFileUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new RemoteFileFetchError("REMOTE_URL_INVALID");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) throw new RemoteFileFetchError("REMOTE_URL_BLOCKED");
  if ((url.protocol === "http:" && url.port && url.port !== "80") || (url.protocol === "https:" && url.port && url.port !== "443")) throw new RemoteFileFetchError("REMOTE_URL_BLOCKED");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  return url;
}

export async function resolvePublicRemoteAddresses(url: URL, resolver: PublicDnsResolver): Promise<PublicDnsAddress[]> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await resolver.resolve(hostname).catch(() => []);
  if (!addresses.length || addresses.some(({ address }) => !isPublicRemoteAddress(address))) throw new RemoteFileFetchError("REMOTE_URL_BLOCKED");
  return addresses;
}

export function createPinnedRemoteLookup(addresses: PublicDnsAddress[]): LookupFunction {
  if (!addresses.length) throw new RemoteFileFetchError("REMOTE_URL_BLOCKED");
  const selected = addresses[0]!;
  return (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) {
      callback(null, addresses.map(({ address, family }) => ({ address, family })));
      return;
    }
    callback(null, selected.address, selected.family);
  };
}

export interface RemoteFetchTransport {
  request(url: URL, addresses: PublicDnsAddress[], signal: AbortSignal): Promise<{ response: Response; close(): Promise<void> }>;
}

const pinnedTransport: RemoteFetchTransport = {
  async request(url, addresses, signal) {
    const dispatcher = new Agent({ connect: { lookup: createPinnedRemoteLookup(addresses) } });
    try {
      const response = await undiciFetch(url, { method: "GET", cache: "no-store", redirect: "manual", signal, dispatcher });
      return { response: response as unknown as Response, close: () => dispatcher.close() };
    } catch (error) {
      await dispatcher.close();
      throw error;
    }
  },
};

export interface FetchedRemoteFile {
  path: string;
  finalUrl: string;
  mimeType: string | null;
  sizeBytes: number;
  digest: `sha256:${string}`;
  createReadStream(): ReturnType<typeof createReadStream>;
  cleanup(): Promise<void>;
}

export async function fetchPublicRemoteFile(input: {
  sourceUrl: string;
  maximumBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  allowedOrigins?: readonly string[];
  resolver?: PublicDnsResolver;
  transport?: RemoteFetchTransport;
}): Promise<FetchedRemoteFile> {
  if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 1 || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1) throw new RemoteFileFetchError("REMOTE_FETCH_UNAVAILABLE");
  const resolver = input.resolver ?? systemPublicDnsResolver;
  const transport = input.transport ?? pinnedTransport;
  const maxRedirects = input.maxRedirects ?? 3;
  const allowedOrigins = input.allowedOrigins ? new Set(input.allowedOrigins.map((origin) => normalizeRemoteFileUrl(origin).origin)) : null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  let directory: string | null = null;
  try {
    let url = normalizeRemoteFileUrl(input.sourceUrl);
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      if (allowedOrigins && !allowedOrigins.has(url.origin)) throw new RemoteFileFetchError("REMOTE_URL_BLOCKED");
      const addresses = await resolvePublicRemoteAddresses(url, resolver);
      let request: Awaited<ReturnType<RemoteFetchTransport["request"]>>;
      try {
        request = await transport.request(url, addresses, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw new RemoteFileFetchError("REMOTE_FETCH_TIMEOUT");
        if (error instanceof RemoteFileFetchError) throw error;
        throw new RemoteFileFetchError("REMOTE_FETCH_UNAVAILABLE");
      }
      const { response } = request;
      if (response.status >= 300 && response.status < 400) {
        try { await response.body?.cancel(); } finally { await request.close(); }
        if (redirectCount === maxRedirects) throw new RemoteFileFetchError("REMOTE_REDIRECT_LIMIT");
        const location = response.headers.get("location");
        if (!location) throw new RemoteFileFetchError("REMOTE_HTTP_ERROR");
        url = normalizeRemoteFileUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) {
        try { await response.body?.cancel(); } finally { await request.close(); }
        throw new RemoteFileFetchError("REMOTE_HTTP_ERROR");
      }
      if (!response.body) {
        await request.close();
        throw new RemoteFileFetchError("REMOTE_BODY_MISSING");
      }
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (!Number.isSafeInteger(declared) || declared < 0 || declared > input.maximumBytes) {
        try { await response.body.cancel(); } finally { await request.close(); }
        throw new RemoteFileFetchError("REMOTE_FILE_TOO_LARGE");
      }
      directory = await mkdtemp(join(tmpdir(), "node-banana-remote-asset-"));
      const path = join(directory, "payload");
      const handle = await open(path, "wx");
      const reader = response.body.getReader();
      const hash = createHash("sha256");
      let sizeBytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          sizeBytes += value.byteLength;
          if (sizeBytes > input.maximumBytes || (declared > 0 && sizeBytes > declared)) throw new RemoteFileFetchError("REMOTE_FILE_TOO_LARGE");
          hash.update(value);
          await handle.write(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        await handle.close();
        await request.close();
      }
      if (!sizeBytes) throw new RemoteFileFetchError("REMOTE_FILE_EMPTY");
      if (declared > 0 && sizeBytes !== declared) throw new RemoteFileFetchError("REMOTE_HTTP_ERROR");
      const ownedDirectory = directory;
      directory = null;
      return {
        path,
        finalUrl: url.toString(),
        mimeType: response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || null,
        sizeBytes,
        digest: `sha256:${hash.digest("hex")}`,
        createReadStream: () => createReadStream(path),
        cleanup: () => rm(ownedDirectory, { recursive: true, force: true }),
      };
    }
    throw new RemoteFileFetchError("REMOTE_REDIRECT_LIMIT");
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true });
    if (controller.signal.aborted && !(error instanceof RemoteFileFetchError && error.code === "REMOTE_FETCH_TIMEOUT")) throw new RemoteFileFetchError("REMOTE_FETCH_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
