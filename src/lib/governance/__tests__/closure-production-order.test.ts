import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSURE_CANONICAL_SURFACES, DrizzleGovernanceWorkspaceClosureAdapter } from "../closure-production";

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
    vi.stubGlobal("fetch", vi.fn(async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { surface: string; preserveRecords: string[] };
      calls.push(body);
      return new Response(JSON.stringify({
        state: "deleted",
        evidenceRef: `proof:${body.surface}`,
        preservedRecords: body.preserveRecords,
        deletionMode: body.surface === "workspace_identity" ? "canonical_close_redaction" : "hard_delete",
      }), { status: 200, headers: { "content-type": "application/json" } });
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
    expect(calls.at(-1)?.preserveRecords).toEqual(expect.arrayContaining(["active workspace_closure resource", "workspace closure completion tombstone"]));
    expect(result.effects).toHaveLength(CLOSURE_CANONICAL_SURFACES.length);
    expect(result.effects.every((effect) => effect.state === "deleted")).toBe(true);
  });

  it("rejects finalization responses that do not prove closure records survived", async () => {
    const called: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { surface: string; preserveRecords: string[] };
      called.push(body.surface);
      return new Response(JSON.stringify({ state: "deleted", evidenceRef: `proof:${body.surface}`, deletionMode: "canonical_close_redaction" }), { status: 200 });
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

  it("propagates verified legal retention through dependent model, rights, and asset phases", async () => {
    const called: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { surface: string; preserveRecords: string[] };
      called.push(body.surface);
      const retained = body.surface === "content_workflows_revisions_and_runs";
      return new Response(JSON.stringify({
        state: retained ? "retained" : "deleted",
        evidenceRef: `proof:${body.surface}`,
        ...(retained ? { legalHoldEvidence: { holdIds: ["hold-a"], policyRevision: 2, evidenceRef: "legal:hold-a" } } : {}),
        preservedRecords: body.preserveRecords,
        deletionMode: body.surface === "workspace_identity" ? "canonical_close_redaction" : "hard_delete",
      }), { status: 200 });
    }));
    const result = await new DrizzleGovernanceWorkspaceClosureAdapter().hardEraseWorkspace({
      workspaceId: "workspace-a", closureId: "closure-a",
      closureLease: { id: "lease_fixture", fence: 1, expiresAt: "2026-09-04T13:00:00.000Z" },
      idempotencyKey: "workspace-closure:closure-a:hard-erasure", evaluatedAt: new Date("2026-09-04T12:00:00.000Z"),
      retainedResources: [{ resourceKind: "workflow", resourceId: "workflow-a", holdIds: ["hold-a"] }],
    });
    for (const surface of ["model_routes_intents_predictions_effects_and_ingestion_receipts", "inspiration_rights_evidence_and_snapshots", "projects_assets_and_generated_artifacts"]) {
      expect(called).not.toContain(surface);
      expect(result.effects.find((effect) => effect.targetId === surface)).toMatchObject({ state: "retained", legalHoldEvidence: { holdIds: ["hold-a"], policyRevision: 2 } });
    }
    expect(result.effects.some((effect) => effect.state === "failed_known" || effect.state === "outcome_unknown")).toBe(false);
    expect(called.at(-1)).toBe("workspace_identity");
  });
});
