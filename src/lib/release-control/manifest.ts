import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const releaseManifestSchema = z.object({
  schema: z.literal("release-manifest/v1"), id: z.string().regex(/^manifest_[A-Za-z0-9._-]{4,100}$/), version: z.number().int().positive(), workspaceId: z.string().min(1).max(200), buildId: z.string().min(1).max(120),
  requiredRoutes: z.array(z.string().startsWith("/").max(240)).min(1).max(200), supportedClients: z.array(z.string().min(1).max(120)).min(1).max(30), dataClasses: z.array(z.string().min(1).max(100)).min(1).max(100), contracts: z.array(z.string().min(1).max(160)).min(1).max(100), parityRequirementIds: z.array(z.string().min(1).max(200)).min(1).max(200),
  issuedAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }), keyId: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
}).strict().superRefine((value, ctx) => { for (const key of ["requiredRoutes", "supportedClients", "dataClasses", "contracts", "parityRequirementIds"] as const) if (new Set(value[key]).size !== value[key].length) ctx.addIssue({ code: "custom", path: [key], message: "Manifest inventory must be unique." }); });
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

function canonical(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`; }
export function signReleaseManifest(manifest: ReleaseManifest, secret: string): string { return `hmac-sha256:${createHmac("sha256", secret).update(canonical(manifest)).digest("hex")}`; }
export function loadReleaseManifest(input: { raw: string | undefined; signature: string | undefined; secret: string | undefined; workspaceId: string; now: Date }): ReleaseManifest {
  if (!input.raw || !input.signature || !input.secret || input.secret.length < 32) throw new TypeError("RELEASE_MANIFEST_MISSING");
  const manifest = releaseManifestSchema.parse(JSON.parse(input.raw)); if (manifest.workspaceId !== input.workspaceId || new Date(manifest.issuedAt) > input.now || new Date(manifest.expiresAt) <= input.now) throw new TypeError("RELEASE_MANIFEST_INVALID");
  const expected = signReleaseManifest(manifest, input.secret); const a = Buffer.from(expected); const b = Buffer.from(input.signature); if (a.length !== b.length || !timingSafeEqual(a, b)) throw new TypeError("RELEASE_MANIFEST_SIGNATURE_INVALID"); return manifest;
}
