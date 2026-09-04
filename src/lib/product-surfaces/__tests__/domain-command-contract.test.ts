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

  it("keeps the generic product-record endpoint read-only", () => {
    const source = read("src/app/api/product-records/route.ts");
    expect(source).toContain("export const GET");
    expect(source).not.toContain("export const POST");
    expect(source).not.toContain("export const PATCH");
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
    expect(source).toContain("stableActivationQuoteId");
    expect(source).toContain("validateCampaignAuthoringPayload");
  });

  it("binds generated Copy only from a succeeded canonical text receipt", () => {
    const source = read("src/lib/product-surfaces/domain-commands.ts");
    expect(source).toContain("modelTextOutputReceipts");
    expect(source).toContain('operation?.state !== "succeeded"');
    expect(source).toContain("operationOutputIds.includes(output.id)");
    expect(source).toContain("updateProductRecordInTransaction(tx");
  });

  it("binds media only from canonical lineage and an immutable Render Proof", () => {
    const source = read("src/lib/product-surfaces/domain-commands.ts");
    expect(source).toContain("isAdmittedContentArtifact");
    expect(source).toContain("validateContentExecutionInput");
    expect(source).toContain("buildQualifiedContentRenderProof");
    expect(source).toContain("candidateArtifactIds: [...payload.candidateArtifactIds");
  });

  it("pins and revalidates governed Content drafts before rendering", () => {
    const source = read("src/lib/product-surfaces/domain-commands.ts");
    expect(source).toContain("resolveActiveContentFormatDefinition");
    expect(source).toContain("validateContentPayload");
    expect(source).toContain("creatorPersonaEvidence");
    expect(source).toContain("contentThemeRevisions");
    expect(source).toContain('const state = validationIssues.length ? "draft" : "active"');
    expect(source).toContain("if (validationIssues.length) throw new Error(validationIssues[0])");
  });

  it("turns an accepted Blitz generation into passed Render Proof evidence", () => {
    const source = read("src/lib/product-surfaces/blitz.ts");
    expect(source).toContain("validateReadyPortraitAsset");
    expect(source).toContain("buildQualifiedContentRenderProof");
    expect(source).toContain('renderProofStatus: "passed"');
    expect(source).toContain("requirePassedBlitzSimilarityEvidence");
  });

  it("links campaign runtime receipts to the central recovery cockpit", () => {
    const source = read("src/app/automations/AutomationBuilder.tsx");
    expect(source).toContain("/studio/operations?selected=");
    expect(read("src/app/studio/operations/OperationsCockpit.tsx")).toContain('searchParams.get("selected")');
  });
});
