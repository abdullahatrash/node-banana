import { describe, expect, it, vi } from "vitest";
import {
  createPinnedRemoteLookup,
  fetchPublicRemoteFile,
  isPublicRemoteAddress,
  RemoteFileFetchError,
  type PublicDnsResolver,
  type RemoteFetchTransport,
} from "../remote-file-fetch";

const publicResolver: PublicDnsResolver = { resolve: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) };
const response = (body: string, init?: ResponseInit) => new Response(body, { status: 200, headers: { "content-type": "image/png", "content-length": String(Buffer.byteLength(body)) }, ...init });

function transport(handler: RemoteFetchTransport["request"]): RemoteFetchTransport {
  return { request: vi.fn(handler) };
}

describe("public remote file fetching", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "0.0.0.0", "240.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"])("blocks special address %s", (address) => {
    expect(isPublicRemoteAddress(address)).toBe(false);
  });

  it("rejects any hostname resolving to a private address before transport", async () => {
    const blockedResolver = { resolve: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]) };
    const request = vi.fn();
    await expect(fetchPublicRemoteFile({ sourceUrl: "https://mixed.example/file", maximumBytes: 20, timeoutMs: 1_000, resolver: blockedResolver, transport: { request } })).rejects.toMatchObject({ code: "REMOTE_URL_BLOCKED" });
    expect(request).not.toHaveBeenCalled();
  });

  it("revalidates every redirect and rejects a redirect to metadata", async () => {
    const requester = transport(async () => ({ response: new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }), close: vi.fn(async () => undefined) }));
    await expect(fetchPublicRemoteFile({ sourceUrl: "https://public.example/file", maximumBytes: 20, timeoutMs: 1_000, resolver: publicResolver, transport: requester })).rejects.toMatchObject({ code: "REMOTE_URL_BLOCKED" });
    expect(requester.request).toHaveBeenCalledTimes(1);
  });

  it("pins the validated DNS answers used by the connection", async () => {
    const addresses = [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }];
    const lookup = createPinnedRemoteLookup(addresses);
    const callback = vi.fn();
    lookup("rebinding.example", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, addresses);
  });

  it("downloads within the byte bound and exposes an immutable digest", async () => {
    const requester = transport(async (_url, addresses) => {
      expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
      return { response: response("payload"), close: vi.fn(async () => undefined) };
    });
    const file = await fetchPublicRemoteFile({ sourceUrl: "https://public.example/file", maximumBytes: 20, timeoutMs: 1_000, resolver: publicResolver, transport: requester });
    try {
      expect(file.sizeBytes).toBe(7);
      expect(file.digest).toBe("sha256:239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5");
    } finally {
      await file.cleanup();
    }
  });

  it("rejects oversized declared and streamed bodies", async () => {
    const declared = transport(async () => ({ response: response("x", { headers: { "content-length": "21" } }), close: vi.fn(async () => undefined) }));
    await expect(fetchPublicRemoteFile({ sourceUrl: "https://public.example/file", maximumBytes: 20, timeoutMs: 1_000, resolver: publicResolver, transport: declared })).rejects.toBeInstanceOf(RemoteFileFetchError);
    const streamed = transport(async () => ({ response: new Response("123456", { headers: { "content-type": "image/png" } }), close: vi.fn(async () => undefined) }));
    await expect(fetchPublicRemoteFile({ sourceUrl: "https://public.example/file", maximumBytes: 5, timeoutMs: 1_000, resolver: publicResolver, transport: streamed })).rejects.toMatchObject({ code: "REMOTE_FILE_TOO_LARGE" });
  });
});
