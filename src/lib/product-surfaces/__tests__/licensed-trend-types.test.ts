import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { licensedTrendCatalogDocumentSchema, licensedTrendCatalogUnsignedSchema, licensedTrendEntitlementDocumentSchema } from "../licensed-trend-types";

const unsigned = licensedTrendCatalogUnsignedSchema.parse({
  schema: "licensed-trend-catalog-entry/v1", id: "catalog_1", revision: 1,
  provider: { key: "licensed.partner", itemId: "partner-item-1", sourceUrl: "https://partner.example/items/1", attribution: "Partner Studio" },
  title: "افتتاحية عربية سريعة", sourceName: "Partner Studio", publishedAt: "2026-09-01T10:00:00.000Z",
  metrics: { views: 120000, likes: 8000, comments: 320, observedAt: "2026-09-02T10:00:00.000Z" },
  media: { type: "video", mimeType: "video/mp4", sizeBytes: 1024, width: 1080, height: 1920, durationSeconds: 12, storageKey: "licensed/catalog_1/source.mp4", versionId: null, etag: "source-etag", digest: `sha256:${"a".repeat(64)}` },
  evidenceDocument: { mimeType: "application/pdf", sizeBytes: 512, storageKey: "licensed/catalog_1/license.pdf", versionId: null, etag: "evidence-etag", digest: `sha256:${"b".repeat(64)}` },
  rights: { basis: "licensed", permittedRemix: "derivative", issuer: { type: "license_authority", id: "partner-studio" }, scope: { commercialUse: true, derivativeUse: true, modelInputUse: true, territories: ["worldwide"] }, issuedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2027-08-01T00:00:00.000Z" },
  classification: { region: "MENA", contentLanguage: "ar", arabicVariety: "gulf", format: "video_hook_demo", tags: ["تقنية"], creativePrimitives: { topics: ["تقنية"], hookPattern: "سؤال مباشر", pacing: "قصّ سريع", structure: ["خطاف", "برهان", "دعوة"] } },
});

describe("licensed trend catalog contracts", () => {
  it("accepts a digest-bound Arabic package with explicit variety and licensed evidence", () => {
    const result = licensedTrendCatalogDocumentSchema.parse({ ...unsigned, digest: canonicalDigest(unsigned) });
    expect(result.classification.arabicVariety).toBe("gulf");
    expect(result.rights.scope.modelInputUse).toBe(true);
  });

  it("rejects Arabic variety on English content and derivative remix without derivative rights", () => {
    const english = { ...unsigned, classification: { ...unsigned.classification, contentLanguage: "en", arabicVariety: "gulf" } };
    expect(licensedTrendCatalogDocumentSchema.safeParse({ ...english, digest: canonicalDigest(english) }).success).toBe(false);
    const noDerivative = { ...unsigned, rights: { ...unsigned.rights, scope: { ...unsigned.rights.scope, derivativeUse: false } } };
    expect(licensedTrendCatalogDocumentSchema.safeParse({ ...noDerivative, digest: canonicalDigest(noDerivative) }).success).toBe(false);
  });

  it("requires immutable catalog identity in each workspace entitlement", () => {
    const entitlement = { schema: "licensed-trend-workspace-entitlement/v1", id: "lte_1", workspaceId: "workspace_1", catalog: { id: unsigned.id, revision: unsigned.revision, digest: `sha256:${"c".repeat(64)}` }, state: "active", territories: ["worldwide"], grantedAt: "2026-09-02T00:00:00.000Z", expiresAt: null, revokedAt: null, grantAuthority: "operator" } as const;
    expect(licensedTrendEntitlementDocumentSchema.parse({ ...entitlement, digest: canonicalDigest(entitlement) }).catalog.revision).toBe(1);
  });
});
