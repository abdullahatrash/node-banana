import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { DnsAddress, DnsResolver } from "./ports";
import { BrandSourceReadError } from "./ports";

export const systemDnsResolver: DnsResolver = {
  async resolve(hostname) {
    return lookup(hostname, { all: true, verbatim: true });
  },
};

function ipv4Number(address: string): number | null {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return (
    ((parts[0] << 24) >>> 0) +
    (parts[1] << 16) +
    (parts[2] << 8) +
    parts[3]
  ) >>> 0;
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
  ];
  return !blocked.some(([base, prefix]) => inV4Range(value, base, prefix));
}

function expandIpv6(address: string): number[] | null {
  let normalized = address.toLowerCase().split("%")[0];
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
  const groups = [
    ...left,
    ...Array(halves.length === 2 ? missing : 0).fill("0"),
    ...right,
  ].map((group) => Number.parseInt(group || "0", 16));
  if (
    groups.length !== 8 ||
    groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)
  ) {
    return null;
  }
  return groups;
}

function isPublicIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups) return false;
  if (groups.every((group) => group === 0)) return false;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
    return false;
  }
  if ((groups[0] & 0xe000) !== 0x2000) return false;
  if ((groups[0] & 0xfe00) === 0xfc00) return false;
  if ((groups[0] & 0xffc0) === 0xfe80) return false;
  if ((groups[0] & 0xff00) === 0xff00) return false;
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return false;
  if (groups[0] === 0x2001 && groups[1] === 0x0000) return false;
  if (groups[0] === 0x2002) return false;
  if (
    groups.slice(0, 5).every((group) => group === 0) &&
    groups[5] === 0xffff
  ) {
    const mapped = `${groups[6] >>> 8}.${groups[6] & 0xff}.${groups[7] >>> 8}.${groups[7] & 0xff}`;
    return isPublicIpv4(mapped);
  }
  return true;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export function normalizeWebsiteUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new BrandSourceReadError("SOURCE_INVALID", "Enter a valid website URL.", false);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BrandSourceReadError(
      "SOURCE_BLOCKED",
      "Only public HTTP and HTTPS websites are supported.",
      false,
    );
  }
  if (url.username || url.password) {
    throw new BrandSourceReadError(
      "SOURCE_BLOCKED",
      "Website URLs cannot contain credentials.",
      false,
    );
  }
  if (
    (url.protocol === "http:" && url.port && url.port !== "80") ||
    (url.protocol === "https:" && url.port && url.port !== "443")
  ) {
    throw new BrandSourceReadError(
      "SOURCE_BLOCKED",
      "Only standard website ports are supported.",
      false,
    );
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  return url;
}

export async function assertPublicUrl(
  url: URL,
  resolver: DnsResolver,
): Promise<DnsAddress[]> {
  const literalFamily = isIP(url.hostname);
  const addresses = literalFamily
    ? [{ address: url.hostname, family: literalFamily }]
    : await resolver.resolve(url.hostname).catch(() => []);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new BrandSourceReadError(
      "SOURCE_BLOCKED",
      "The website does not resolve to a public internet address.",
      false,
    );
  }
  return addresses;
}

