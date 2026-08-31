import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const studioRoot = resolve(process.cwd(), "src/app/api/studio");

function routeSources(): Array<{ path: string; source: string }> {
  return readdirSync(studioRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === "route.ts")
    .map((entry) => {
      const path = resolve(entry.parentPath, entry.name);
      return { path: relative(studioRoot, path), source: readFileSync(path, "utf8") };
    });
}

const typedDomainErrorGuards = new Map<string, RegExp>([
  ["assets/[assetId]/route.ts", /error instanceof StudioAssetUploadTransitionError/],
  ["credential-spend-grants/route.ts", /error instanceof CredentialVaultError/],
  ["credentials/route.ts", /error instanceof CredentialVaultError/],
  ["credentials/[profileId]/reprovision/route.ts", /error instanceof CredentialVaultError/],
  ["credentials/[profileId]/rotate/route.ts", /error instanceof CredentialVaultError/],
]);

describe("Studio error response allowlist", () => {
  it("never returns an arbitrary caught Error message", () => {
    for (const route of routeSources()) {
      expect(route.source, route.path).not.toMatch(
        /error\s*:\s*error\s+instanceof\s+Error\s*\?\s*error\.message/,
      );
    }
  });

  it("returns error.message only after an allowlisted typed-domain guard", () => {
    const rawMessageRoutes = routeSources().filter(({ source }) =>
      /error\s*:\s*error\.message/.test(source),
    );
    expect(rawMessageRoutes.map(({ path }) => path).sort()).toEqual(
      [...typedDomainErrorGuards.keys()].sort(),
    );
    for (const route of rawMessageRoutes) {
      expect(route.source, route.path).toMatch(typedDomainErrorGuards.get(route.path)!);
    }
  });
});
