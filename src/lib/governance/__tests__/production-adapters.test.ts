import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  region: vi.fn(), getAsset: vi.fn(), deleteObject: vi.fn(), softDeleteAsset: vi.fn(), softDeletePrompt: vi.fn(), deleteSocialPost: vi.fn(),
}));
vi.mock("../region-enforcement", () => ({ GOVERNANCE_REGION_ROUTES: { deletion: { kind: "deletion", routeId: "deletion:workspace-resources" } }, requireGovernanceRegionRoute: (...args: unknown[]) => mocks.region(...args) }));
vi.mock("@/lib/storage", () => ({ deleteObjectFromS3: (...args: unknown[]) => mocks.deleteObject(...args) }));
vi.mock("@/lib/studio/repository", () => ({ getAsset: (...args: unknown[]) => mocks.getAsset(...args), softDeleteAsset: (...args: unknown[]) => mocks.softDeleteAsset(...args), softDeletePrompt: (...args: unknown[]) => mocks.softDeletePrompt(...args) }));
vi.mock("@/lib/social/repository", () => ({ deleteSocialPost: (...args: unknown[]) => mocks.deleteSocialPost(...args) }));

import { ProductionGovernanceDeletionAdapter, ProductionGovernanceSafetyRevalidationAdapter } from "../production-adapters";

describe("production governance effect adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GOVERNANCE_DELETION_ADAPTER_URL;
    delete process.env.GOVERNANCE_DELETION_ADAPTER_SECRET;
    delete process.env.GOVERNANCE_SAFETY_REVALIDATION_URL;
    delete process.env.GOVERNANCE_SAFETY_REVALIDATION_SECRET;
  });

  it("deletes an exact Workspace asset object before its canonical record", async () => {
    mocks.getAsset.mockResolvedValue({ id: "asset-1", workspaceId: "workspace-a", storageProvider: "s3", storageKey: "workspace/workspace-a/asset.png" });
    mocks.softDeleteAsset.mockResolvedValue({ id: "asset-1" });
    const result = await new ProductionGovernanceDeletionAdapter().delete({ workspaceId: "workspace-a", system: "primary", resourceKind: "media", resourceId: "asset-1", retentionClass: "workspace_media", idempotencyKey: "delete-1:primary" });
    expect(mocks.region).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-a", route: { kind: "deletion", routeId: "deletion:workspace-resources" } }));
    expect(mocks.deleteObject).toHaveBeenCalledWith({ key: "workspace/workspace-a/asset.png" });
    expect(mocks.softDeleteAsset).toHaveBeenCalledWith("workspace-a", "asset-1");
    expect(result).toMatchObject({ state: "deleted" });
  });

  it("makes unconfigured external deletion and safety systems explicit and fail-closed", async () => {
    await expect(new ProductionGovernanceDeletionAdapter().delete({ workspaceId: "workspace-a", system: "backup", resourceKind: "media", resourceId: "asset-1", retentionClass: "workspace_media", idempotencyKey: "delete-1:backup" }))
      .resolves.toEqual({ state: "failed_known", reason: "DELETION_SYSTEM_ADAPTER_NOT_CONFIGURED" });
    await expect(new ProductionGovernanceSafetyRevalidationAdapter().revalidate({ workspaceId: "workspace-a", intentRef: "intent-1", originalDecisionId: "decision-1", originalPolicyVersion: "v1", originalEvidenceRef: "evidence-1", idempotencyKey: "appeal-1" }))
      .resolves.toMatchObject({ outcome: "blocked", currentPolicyVersion: "unconfigured" });
  });

  it.each(["consent_evidence", "security_evidence", "billing_tax_evidence", "provider_diagnostic", "support_attachment"])("deletes the exact %s through its canonical primary adapter", async (resourceKind) => {
    const remove = vi.fn().mockResolvedValue({ state: "deleted", evidenceRef: `primary:delete-${resourceKind}` });
    const result = await new ProductionGovernanceDeletionAdapter({ delete: remove }).delete({
      workspaceId: "workspace-a",
      system: "primary",
      resourceKind,
      resourceId: "evidence-1",
      retentionClass: resourceKind as never,
      idempotencyKey: `delete-${resourceKind}`,
    });
    expect(remove).toHaveBeenCalledWith({ workspaceId: "workspace-a", resourceKind, resourceId: "evidence-1", idempotencyKey: `delete-${resourceKind}` });
    expect(result).toMatchObject({ state: "deleted" });
  });
});
