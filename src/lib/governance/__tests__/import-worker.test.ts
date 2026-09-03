import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { GovernanceImportWorker } from "../import-worker";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { GovernanceService } from "../service";

const now = new Date("2026-09-03T12:00:00.000Z");
const actor = { workspaceId: "workspace-a", userId: "owner-a", legacyRole: "owner" as const };

describe("GovernanceImportWorker", () => {
  it("materializes signed transferable configuration with source provenance and explicit omissions", async () => {
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => new Date(now) });
    const payload = { name: "Imported portfolio", workspaceIds: ["workspace-a"] };
    const manifestDigest = canonicalDigest({ manifest: 1 });
    const preview = await service.execute(actor, { type: "preview_import", source: "workspace-export:source-workspace", sourceManifestDigest: manifestDigest, items: [
      { kind: "portfolio", sourceId: "portfolio-source", destinationId: "portfolio-imported", digest: canonicalDigest(payload), transferable: true, payload },
      { kind: "invitation_binding", sourceId: "invite-secret", digest: canonicalDigest({ secret: true }), transferable: false, omissionReason: "secret-bearing invitation bindings are not transferable" },
    ] }, "preview-signed-import") as { importId: string };
    await service.execute(actor, { type: "execute_import", importId: preview.importId }, "execute-signed-import");
    const worker = new GovernanceImportWorker(repository, { now: () => new Date("2026-09-03T12:01:00.000Z") });
    await worker.process({ workspaceId: actor.workspaceId, importId: preview.importId });
    await worker.process({ workspaceId: actor.workspaceId, importId: preview.importId });

    const imported = await repository.getResource<{ _importProvenance: { sourceManifestDigest: string; sourceId: string; sourceItemDigest: string } }>({ workspaceId: actor.workspaceId, kind: "portfolio", id: "portfolio-imported" });
    expect(imported?.body._importProvenance).toEqual(expect.objectContaining({ sourceManifestDigest: manifestDigest, sourceId: "portfolio-source", sourceItemDigest: canonicalDigest(payload) }));
    const job = await repository.getResource<{ items: Array<{ state: string; outcome: Record<string, unknown> }> }>({ workspaceId: actor.workspaceId, kind: "workspace_import", id: preview.importId });
    expect(job?.status).toBe("succeeded");
    expect(job?.body.items.map((item) => item.state)).toEqual(["created", "omitted"]);
    expect(job?.body.items[1].outcome).toEqual({ omissionReason: "secret-bearing invitation bindings are not transferable" });
  });

  it("fails a signed but unsupported transferable kind without partially materializing it", async () => {
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => new Date(now) });
    const payload = { arbitrary: true };
    const preview = await service.execute(actor, { type: "preview_import", source: "workspace-export", sourceManifestDigest: canonicalDigest({ manifest: 2 }), items: [{ kind: "review_guest_grant", sourceId: "guest-1", digest: canonicalDigest(payload), transferable: true, payload }] }, "preview-unsupported-import") as { importId: string };
    await service.execute(actor, { type: "execute_import", importId: preview.importId }, "execute-unsupported-import");
    await new GovernanceImportWorker(repository).process({ workspaceId: actor.workspaceId, importId: preview.importId });
    expect((await repository.getResource({ workspaceId: actor.workspaceId, kind: "workspace_import", id: preview.importId }))?.status).toBe("failed_known");
    expect(await repository.getResource({ workspaceId: actor.workspaceId, kind: "review_guest_grant", id: `imported_${canonicalDigest(payload).slice(7, 39)}` })).toBeNull();
  });
});
