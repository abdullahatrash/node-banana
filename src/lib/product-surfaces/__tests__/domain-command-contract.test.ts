import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("typed product command contracts", () => {
  it("uses exact product capabilities rather than Workspace mutation", () => {
    expect(read("src/app/api/product-content/route.ts")).toContain('permission: "product:content:write"');
    expect(read("src/app/api/product-inspiration/route.ts")).toContain('permission: "product:inspiration:write"');
    expect(read("src/app/api/product-campaigns/route.ts")).toContain('permission: "product:campaigns:write"');
    expect(read("src/app/api/product-support/submit/route.ts")).toContain('permission: "product:support:submit"');
  });

  it("resolves support attachment evidence inside the record transaction", () => {
    const source = read("src/lib/product-support/commands.ts");
    expect(source).toContain("getDb().transaction");
    expect(source).toContain("resolveSupportAttachmentReferencesWithExecutor(tx");
    expect(source).toContain("createProductRecordInTransaction(tx");
  });

  it("requires canonical source and immutable rights evidence for Inspiration", () => {
    const source = read("src/lib/product-surfaces/inspiration-commands.ts");
    expect(source).toContain("INSPIRATION_ASSET_NOT_READY");
    expect(source).toContain("INSPIRATION_RIGHTS_NOT_ADMITTED");
    expect(source).toContain("validateRightsEvidence");
  });

  it("activates campaigns only through a quoted durable Workflow Run", () => {
    const source = read("src/lib/product-surfaces/campaign-runtime.ts");
    expect(source).toContain("runtime.preview");
    expect(source).toContain("issueCampaignAcceptedQuote");
    expect(read("src/lib/product-surfaces/campaign-quote.ts")).toContain("input.codec.seal(quote)");
    expect(source).toContain('capability: "workflow_runs.start@2"');
    expect(source).toContain("acceptedSpendQuoteRef");
  });
});
