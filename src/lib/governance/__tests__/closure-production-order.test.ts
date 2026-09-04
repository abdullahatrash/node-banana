import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSURE_CANONICAL_SURFACES, DrizzleGovernanceWorkspaceClosureAdapter } from "../closure-production";

const preflightDigest = `sha256:${"a".repeat(64)}`;
const tombstoneDigest = `sha256:${"b".repeat(64)}`;
const retentionRevisionBody = {
  schema: "retention-policy-revision/v2" as const,
  revision: 2,
  rules: [{ retentionClass: "generation_rights_evidence", durationDays: 365, recoverableDays: 0, legalFloorDays: 365 }],
  legalFloorSource: "deployment_trusted/v2" as const,
  createdAt: "2026-09-01T12:00:00.000Z",
};
const retentionRevision = { revision: retentionRevisionBody, digest: `sha256:${"e".repeat(64)}` };
const preflight = (outcome: "eligible" | "blocked_retention_hold" | "blocked_retention_period" = "eligible") => ({
  schema: "generation-rights-erasure-preflight-result/v1", outcome, preflightDigest,
  evidenceRowCount: 1, snapshotRowCount: 1, retentionPolicyRevision: 2, retentionRevision,
  signingKeyId: "key-a", auditSequence: 4,
  auditEventId: `${outcome === "eligible" ? "rights_preflight_" : "rights_erasure_attempt_"}${"c".repeat(32)}`,
  blockingHoldIds: outcome === "blocked_retention_hold" ? ["hold-rights"] : [], eligibleAt: outcome === "blocked_retention_period" ? "2027-09-04T12:00:00.000Z" : null,
  evaluatedAt: "2026-09-04T12:00:00.000Z",
});

function successfulEffect(body: { surface: string; preserveRecords: string[] }) {
  if (body.surface === "inspiration_rights_evidence_and_snapshots") return {
    state: "deleted", evidenceRef: tombstoneDigest,
    rightsErasureResult: { schema: "generation-rights-erasure-result/v2", outcome: "erased", tombstoneDigest, evidenceRowCount: 1, snapshotRowCount: 1, erasedAt: "2026-09-04T12:00:01.000Z", signingKeyId: "key-a", auditSequence: 5, auditEventId: `rights_erasure_${"d".repeat(32)}`, preflightDigest },
  };
  return { state: "deleted", evidenceRef: `proof:${body.surface}`, preservedRecords: body.preserveRecords, deletionMode: body.surface === "workspace_identity" ? "canonical_close_redaction" : "hard_delete", ...(["content_workflows_revisions_and_runs", "model_routes_intents_predictions_effects_and_ingestion_receipts"].includes(body.surface) ? { generationRightsPreflightDigest: preflightDigest } : {}) };
}

describe("production closure hard-erasure ordering", () => {
  beforeEach(() => {
    process.env.GOVERNANCE_CLOSURE_EFFECT_URL = "https://closure.example.test";
    process.env.GOVERNANCE_CLOSURE_EFFECT_SECRET = "test-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GOVERNANCE_CLOSURE_EFFECT_URL;
    delete process.env.GOVERNANCE_CLOSURE_EFFECT_SECRET;
  });

  it("runs rights dependents, rights, other asset dependents, assets, governance, then identity", async () => {
    const calls: Array<{ surface: string; preserveRecords: string[] }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      if (String(url).includes("generation-rights-preflight")) return new Response(JSON.stringify(preflight()), { status: 200 });
      const body = JSON.parse(String(init.body)) as { surface: string; preserveRecords: string[] };
      calls.push(body);
      return new Response(JSON.stringify(successfulEffect(body)), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const result = await new DrizzleGovernanceWorkspaceClosureAdapter().hardEraseWorkspace({
      workspaceId: "workspace-a", closureId: "closure-a",
      closureLease: { id: "lease_fixture", fence: 1, expiresAt: "2026-09-04T13:00:00.000Z" },
      idempotencyKey: "workspace-closure:closure-a:hard-erasure", evaluatedAt: new Date("2026-09-04T12:00:00.000Z"), retainedResources: [],
    });
    const index = (surface: string) => calls.findIndex((call) => call.surface === surface);
    expect(index("content_workflows_revisions_and_runs")).toBeLessThan(index("model_routes_intents_predictions_effects_and_ingestion_receipts"));
    expect(index("content_workflows_revisions_and_runs")).toBeLessThan(index("inspiration_rights_evidence_and_snapshots"));
    expect(index("model_routes_intents_predictions_effects_and_ingestion_receipts")).toBeLessThan(index("inspiration_rights_evidence_and_snapshots"));
    expect(index("inspiration_rights_evidence_and_snapshots")).toBeLessThan(index("brand_profiles_sources_and_saved_prompts"));
    expect(index("brand_profiles_sources_and_saved_prompts")).toBeLessThan(index("projects_assets_and_generated_artifacts"));
    expect(index("release_attestations_manifests_flags_and_audit_lineage")).toBeLessThan(index("projects_assets_and_generated_artifacts"));
    expect(index("projects_assets_and_generated_artifacts")).toBeLessThan(index("audit_exports_imports_and_governance_receipts"));
    expect(index("audit_exports_imports_and_governance_receipts")).toBeLessThan(index("workspace_identity"));
    expect(calls.at(-1)?.surface).toBe("workspace_identity");
    expect(calls.at(-1)?.preserveRecords).toEqual(expect.arrayContaining([
      "active workspace_closure resource",
      "workspace closure completion tombstone",
      "workspace_closures.preflight_generation_rights@1 receipts",
      "workspace_closures.preflight_generation_rights@1 audit events",
      "workspace_closures.erase_generation_rights_attempt@1 receipts",
      "workspace_closures.erase_generation_rights_attempt@1 audit events",
    ]));
    expect(result.effects).toHaveLength(CLOSURE_CANONICAL_SURFACES.length);
    expect(result.effects.every((effect) => effect.state === "deleted")).toBe(true);
  });

  it("rejects finalization responses that do not prove closure records survived", async () => {
    const called: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      if (String(url).includes("generation-rights-preflight")) return new Response(JSON.stringify(preflight()), { status: 200 });
      const body = JSON.parse(String(init.body)) as { surface: string; preserveRecords: string[] };
      called.push(body.surface);
      const response = successfulEffect(body);
      if (body.surface !== "inspiration_rights_evidence_and_snapshots") delete (response as { preservedRecords?: string[] }).preservedRecords;
      return new Response(JSON.stringify(response), { status: 200 });
    }));
    const result = await new DrizzleGovernanceWorkspaceClosureAdapter().hardEraseWorkspace({
      workspaceId: "workspace-a", closureId: "closure-a",
      closureLease: { id: "lease_fixture", fence: 1, expiresAt: "2026-09-04T13:00:00.000Z" },
      idempotencyKey: "workspace-closure:closure-a:hard-erasure", evaluatedAt: new Date("2026-09-04T12:00:00.000Z"), retainedResources: [],
    });
    expect(result.effects.filter((effect) => effect.targetId === "audit_exports_imports_and_governance_receipts")[0]).toMatchObject({ state: "failed_known", reason: "CLOSURE_PROOF_PRESERVATION_NOT_PROVEN" });
    expect(result.effects.filter((effect) => effect.targetId === "workspace_identity")[0]).toMatchObject({ state: "failed_known", reason: "GOVERNANCE_ERASURE_NOT_TERMINAL" });
    expect(called).not.toContain("workspace_identity");
  });

  it("retains only rights-dependent surfaces while erasing independent surfaces under an active rights hold", async () => {
    const called: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      if (String(url).includes("generation-rights-preflight")) return new Response(JSON.stringify(preflight("blocked_retention_hold")), { status: 200 });
      const body = JSON.parse(String(init.body)) as { surface: string; preserveRecords: string[] };
      called.push(body.surface);
      return new Response(JSON.stringify(successfulEffect(body)), { status: 200 });
    }));
    const result = await new DrizzleGovernanceWorkspaceClosureAdapter().hardEraseWorkspace({
      workspaceId: "workspace-a", closureId: "closure-a",
      closureLease: { id: "lease_fixture", fence: 1, expiresAt: "2026-09-04T13:00:00.000Z" },
      idempotencyKey: "workspace-closure:closure-a:hard-erasure", evaluatedAt: new Date("2026-09-04T12:00:00.000Z"),
      retainedResources: [{ resourceKind: "workflow", resourceId: "workflow-a", holdIds: ["hold-a"] }],
    });
    expect(called).not.toContain("content_workflows_revisions_and_runs");
    expect(called).not.toContain("model_routes_intents_predictions_effects_and_ingestion_receipts");
    expect(called).not.toContain("inspiration_rights_evidence_and_snapshots");
    expect(called).not.toContain("projects_assets_and_generated_artifacts");
    expect(called).not.toContain("audit_exports_imports_and_governance_receipts");
    expect(called).not.toContain("memberships_invitations_and_role_assignments");
    expect(called).not.toContain("workspace_identity");
    expect(called).toContain("brand_profiles_sources_and_saved_prompts");
    expect(result.effects.filter((effect) => !called.includes(effect.targetId)).every((effect) => effect.state === "retained" && effect.legalHoldEvidence?.holdIds[0] === "hold-rights")).toBe(true);
    expect(result.retainedResources).toContainEqual({ resourceKind: "generation_rights_evidence", resourceId: "workspace:workspace-a", holdIds: ["hold-rights"] });
    expect(result.effects.some((effect) => effect.state === "failed_known" || effect.state === "outcome_unknown")).toBe(false);
  });

  it("returns the finite rights-hold expiry as the next safe revalidation time", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      if (String(url).includes("generation-rights-preflight")) return new Response(JSON.stringify({ ...preflight("blocked_retention_hold"), eligibleAt: "2026-09-10T12:00:00.000Z" }), { status: 200 });
      const body = JSON.parse(String(init.body)) as { surface: string; preserveRecords: string[] };
      return new Response(JSON.stringify(successfulEffect(body)), { status: 200 });
    }));
    const result = await new DrizzleGovernanceWorkspaceClosureAdapter().hardEraseWorkspace({ workspaceId: "workspace-a", closureId: "closure-a", closureLease: { id: "lease_fixture", fence: 1, expiresAt: "2026-09-04T13:00:00.000Z" }, idempotencyKey: "workspace-closure:closure-a:hard-erasure", evaluatedAt: new Date("2026-09-04T12:00:00.000Z"), retainedResources: [] });
    expect(result.retryAt).toBe("2026-09-10T12:00:00.000Z");
    expect(result.effects.find((effect) => effect.targetId === "workspace_identity")).toMatchObject({ state: "retained", reason: "DEPENDENCY_LEGALLY_RETAINED" });
  });

  it("rejects a generic deleted response at the generation-rights boundary", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      if (String(url).includes("generation-rights-preflight")) return new Response(JSON.stringify(preflight()), { status: 200 });
      const body = JSON.parse(String(init.body)) as { surface: string; preserveRecords: string[] };
      if (body.surface === "inspiration_rights_evidence_and_snapshots") return new Response(JSON.stringify({ state: "deleted", evidenceRef: "arbitrary:proof" }), { status: 200 });
      return new Response(JSON.stringify(successfulEffect(body)), { status: 200 });
    }));
    const result = await new DrizzleGovernanceWorkspaceClosureAdapter().hardEraseWorkspace({ workspaceId: "workspace-a", closureId: "closure-a", closureLease: { id: "lease_fixture", fence: 1, expiresAt: "2026-09-04T13:00:00.000Z" }, idempotencyKey: "workspace-closure:closure-a:hard-erasure", evaluatedAt: new Date("2026-09-04T12:00:00.000Z"), retainedResources: [] });
    expect(result.effects.find((effect) => effect.targetId === "inspiration_rights_evidence_and_snapshots")).toMatchObject({ state: "failed_known", reason: "CLOSURE_EFFECT_RESPONSE_INVALID" });
  });

  it("rejects a shaped SQL v2 result whose counts do not match its preflight", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      if (String(url).includes("generation-rights-preflight")) return new Response(JSON.stringify(preflight()), { status: 200 });
      const body = JSON.parse(String(init.body)) as { surface: string; preserveRecords: string[] };
      const response = successfulEffect(body);
      if (body.surface === "inspiration_rights_evidence_and_snapshots") (response as { rightsErasureResult: { evidenceRowCount: number } }).rightsErasureResult.evidenceRowCount = 2;
      return new Response(JSON.stringify(response), { status: 200 });
    }));
    const result = await new DrizzleGovernanceWorkspaceClosureAdapter().hardEraseWorkspace({ workspaceId: "workspace-a", closureId: "closure-a", closureLease: { id: "lease_fixture", fence: 1, expiresAt: "2026-09-04T13:00:00.000Z" }, idempotencyKey: "workspace-closure:closure-a:hard-erasure", evaluatedAt: new Date("2026-09-04T12:00:00.000Z"), retainedResources: [] });
    expect(result.effects.find((effect) => effect.targetId === "inspiration_rights_evidence_and_snapshots")).toMatchObject({ state: "failed_known", reason: "GENERATION_RIGHTS_SQL_RESULT_INVALID", idempotencyKey: expect.stringContaining(preflightDigest) });
  });

  it("preserves the signed retention eligible time without calling a destructive endpoint", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify(preflight("blocked_retention_period")), { status: 200 });
    }));
    const result = await new DrizzleGovernanceWorkspaceClosureAdapter().hardEraseWorkspace({ workspaceId: "workspace-a", closureId: "closure-a", closureLease: { id: "lease_fixture", fence: 1, expiresAt: "2026-09-04T13:00:00.000Z" }, idempotencyKey: "workspace-closure:closure-a:hard-erasure", evaluatedAt: new Date("2026-09-04T12:00:00.000Z"), retainedResources: [] });
    expect(result.retryAt).toBe("2027-09-04T12:00:00.000Z");
    expect(calls).toHaveLength(1);
  });

  it("propagates a non-rights multi-resource hold union without inventing a rights-hold descriptor", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      if (String(url).includes("generation-rights-preflight")) return new Response(JSON.stringify(preflight()), { status: 200 });
      const body = JSON.parse(String(init.body)) as { surface: string; preserveRecords: string[] };
      if (body.surface === "content_workflows_revisions_and_runs") return new Response(JSON.stringify({ state: "retained", evidenceRef: "hold:content", legalHoldEvidence: { holdIds: ["hold-a", "hold-b"], policyRevision: 2, evidenceRef: "hold:content" }, generationRightsPreflightDigest: preflightDigest }), { status: 200 });
      return new Response(JSON.stringify(successfulEffect(body)), { status: 200 });
    }));
    const retainedResources = [
      { resourceKind: "content", resourceId: "content-a", holdIds: ["hold-a"] },
      { resourceKind: "content", resourceId: "content-b", holdIds: ["hold-b"] },
    ];
    const result = await new DrizzleGovernanceWorkspaceClosureAdapter().hardEraseWorkspace({ workspaceId: "workspace-a", closureId: "closure-a", closureLease: { id: "lease_fixture", fence: 1, expiresAt: "2026-09-04T13:00:00.000Z" }, idempotencyKey: "workspace-closure:closure-a:hard-erasure", evaluatedAt: new Date("2026-09-04T12:00:00.000Z"), retainedResources });
    expect(result.effects.find((effect) => effect.targetId === "inspiration_rights_evidence_and_snapshots")).toMatchObject({ state: "retained", reason: "DEPENDENCY_LEGALLY_RETAINED" });
    expect(result.effects.find((effect) => effect.targetId === "inspiration_rights_evidence_and_snapshots")?.legalHoldEvidence?.holdIds).toEqual(["hold-a", "hold-b"]);
    expect(result.retainedResources).toEqual(retainedResources);
  });

  it("does not advance to governance or identity on an unbound retained response", async () => {
    const called: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      if (String(url).includes("generation-rights-preflight")) return new Response(JSON.stringify(preflight()), { status: 200 });
      const body = JSON.parse(String(init.body)) as { surface: string; preserveRecords: string[] };
      called.push(body.surface);
      if (body.surface === "content_workflows_revisions_and_runs") return new Response(JSON.stringify({ state: "retained", evidenceRef: "unbound", legalHoldEvidence: { holdIds: ["invented-hold"], policyRevision: 2, evidenceRef: "unbound" }, generationRightsPreflightDigest: preflightDigest }), { status: 200 });
      return new Response(JSON.stringify(successfulEffect(body)), { status: 200 });
    }));
    await new DrizzleGovernanceWorkspaceClosureAdapter().hardEraseWorkspace({ workspaceId: "workspace-a", closureId: "closure-a", closureLease: { id: "lease_fixture", fence: 1, expiresAt: "2026-09-04T13:00:00.000Z" }, idempotencyKey: "workspace-closure:closure-a:hard-erasure", evaluatedAt: new Date("2026-09-04T12:00:00.000Z"), retainedResources: [] });
    expect(called).not.toContain("audit_exports_imports_and_governance_receipts");
    expect(called).not.toContain("memberships_invitations_and_role_assignments");
    expect(called).not.toContain("workspace_identity");
  });
});
