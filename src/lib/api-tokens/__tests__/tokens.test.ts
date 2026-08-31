import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  API_TOKEN_PREFIX,
  generateApiToken,
  hashApiToken,
} from "../tokens";

describe("api token crypto", () => {
  it("generates a raw token carrying the recognizable nb_ prefix", () => {
    const token = generateApiToken();

    expect(token.raw.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(API_TOKEN_PREFIX).toBe("nb_");
    // Non-trivial secret material beyond the prefix.
    expect(token.raw.length).toBeGreaterThan(API_TOKEN_PREFIX.length + 20);
  });

  it("never returns the raw token as its own hash", () => {
    const token = generateApiToken();

    expect(token.hash).not.toBe(token.raw);
    expect(token.hash).toHaveLength(64); // sha-256 hex digest
  });

  it("stores a non-secret display prefix that matches the head of the raw token", () => {
    const token = generateApiToken();

    expect(token.raw.startsWith(token.prefix)).toBe(true);
    expect(token.prefix.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(token.prefix.length).toBeLessThan(token.raw.length);
  });

  it("produces two different tokens on consecutive calls", () => {
    expect(generateApiToken().raw).not.toBe(generateApiToken().raw);
  });

  it("hashes deterministically with SHA-256 so lookups can match by hash", () => {
    const token = generateApiToken();
    const expected = createHash("sha256").update(token.raw).digest("hex");

    expect(hashApiToken(token.raw)).toBe(expected);
    expect(hashApiToken(token.raw)).toBe(token.hash);
  });
});
