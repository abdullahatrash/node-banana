import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlitzClient } from "../BlitzClient";

const productRequest = vi.fn();
const runGeneration = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useFormatter: () => ({ dateTime: () => "Sep 4" }) }));
vi.mock("@/components/product-surfaces/ProductApi", () => ({ productRequest: (...args: unknown[]) => productRequest(...args), ProductRequestError: class ProductRequestError extends Error { constructor(readonly code: string) { super(code); } } }));
vi.mock("@/components/simple-studio-shell/forms/ModelSelect", () => ({ ModelSelect: () => <div data-testid="model" /> }));
vi.mock("@/components/simple-studio-shell/forms/GenerationAdmissionPanel", () => ({ GenerationAdmissionPanel: () => <div data-testid="admission" /> }));
vi.mock("@/lib/model-routing/studio-generation-client", () => ({ runAdmittedStudioGeneration: (...args: unknown[]) => runGeneration(...args) }));
vi.mock("@/store/simpleStudioStore", () => ({ requestStudioManagedCreditQuoteConfirmation: vi.fn(), useSimpleStudioStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ selectedModelId: "model", selectedModelProvider: "replicate", selectedModelVersion: "v1", selectedModelSchemaDigest: `sha256:${"a".repeat(64)}`, fundingMode: "managed", setSourceImage: vi.fn() }) }));

const rightsDigest = `sha256:${"b".repeat(64)}`;
const item = { id: "blitz-1", title: "Proposal", revision: 3, payload: { inspirationItemId: "inspiration-1", sourceAssetId: "source", sourceMediaType: "video", sourceAttribution: "https://example.com/source", rightsSnapshot: { id: "rights", revision: 1, digest: rightsDigest }, rightsBasis: "licensed", permittedRemix: "transform", rightsEvidenceIds: ["rights"], contentLanguage: "ar", arabicVariety: "gulf", format: "video_hook_demo", rationale: "Original Arabic remix", remixBrief: { schema: "brand-aware-remix-brief/v1", brandProfile: { id: "brand-1", revision: 2, digest: `sha256:${"c".repeat(64)}`, acceptedAt: "2026-09-03T00:00:00.000Z" }, source: { inspirationItemId: "inspiration-1", revision: 4, evidenceDigest: null, rightsSnapshotDigest: rightsDigest }, locale: { contentLanguage: "ar", arabicVariety: "gulf" }, influencePlan: [{ kind: "topic", direction: "Licensed topic only" }], brandDirection: { audience: "Gulf founders", angle: "Original launch", voice: ["clear"], offering: "Product", callToAction: "Try it" }, provider: { prompt: "Original brand-aware Arabic prompt", preserve: ["brand"], transform: ["wording"], avoid: ["source expression"] }, protectedExpressionExcluded: true, createdAt: "2026-09-04T00:00:00.000Z", digest: `sha256:${"d".repeat(64)}` }, sourceComparison: { views: 10, likes: 2, observedAt: "2026-09-04T00:00:00.000Z" } } };

describe("BlitzClient", () => {
  beforeEach(() => { productRequest.mockReset(); runGeneration.mockReset(); });

  it("requires structured rejection feedback", async () => {
    productRequest.mockResolvedValue({ success: true });
    render(<BlitzClient items={[item]} generatedAt="2026-09-04T01:00:00.000Z" />);
    await userEvent.click(screen.getByRole("button", { name: "reject" }));
    await userEvent.click(screen.getByLabelText("rejectionReasons.brand_mismatch"));
    await userEvent.click(screen.getByRole("button", { name: "confirmReject" }));
    await waitFor(() => expect(productRequest).toHaveBeenCalledWith("/api/blitz/decision", expect.objectContaining({ decision: "rejected", reasons: [{ code: "brand_mismatch", note: "" }], generation: null, similarityEvidenceId: null, expectedRevision: 3 })));
  });

  it("binds a passed text/frame/audio evidence id before acceptance", async () => {
    runGeneration.mockResolvedValue({ assetId: "candidate", intentId: "intent", operationId: "operation" });
    productRequest.mockImplementation(async (path: string) => path === "/api/blitz/similarity" ? { success: true, evidenceId: "evidence", evidence: { status: "passed" } } : { success: true });
    render(<BlitzClient items={[item]} generatedAt="2026-09-04T01:00:00.000Z" />);
    await userEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => expect(productRequest).toHaveBeenCalledWith("/api/blitz/similarity", { itemId: "blitz-1", expectedRevision: 3, candidateAssetId: "candidate" }));
    expect(runGeneration).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Original brand-aware Arabic prompt", remixBrief: { preserve: ["brand"], transform: ["wording"], avoid: ["source expression"] }, blitzContext: { itemId: "blitz-1", expectedRevision: 3 } }));
    expect(productRequest).toHaveBeenCalledWith("/api/blitz/decision", expect.objectContaining({ decision: "accepted", similarityEvidenceId: "evidence", generation: { assetId: "candidate", intentId: "intent", operationId: "operation" } }));
    expect(screen.getByTestId("admission")).toBeInTheDocument();
  });
});
