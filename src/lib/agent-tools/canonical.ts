import { createHash } from "node:crypto";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }

  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || Object.is(value, -0))
  ) {
    throw new TypeError("Canonical JSON only supports finite, non-negative-zero numbers.");
  }

  return value;
}

/** RFC-8785-style canonical JSON for the contract shapes used by the runtime. */
export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(normalize(value));
  if (serialized === undefined) {
    throw new TypeError("Value cannot be represented as canonical JSON.");
  }
  return serialized;
}

export function canonicalDigest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")}`;
}
