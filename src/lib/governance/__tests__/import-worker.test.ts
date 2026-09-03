import { describe, expect, it, vi } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { GovernanceImportWorker } from "../import-worker";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { GovernanceService } from "../service";
import type { GovernancePortableDataPort, GovernancePortableKind } from "../portability";
import { copyPortableMediaIntoPrimaryStorage, validatePortablePayload, workspaceIdFromExportSource } from "../portability";

const now = new Date("2026-09-03T12:00:00.000Z");
const actor = { workspaceId: "workspace-a", userId: "owner-a", legacyRole: "owner" as const, authContextId: "session-owner-a" };
const signature = "A".repeat(43);

function payload(kind: GovernancePortableKind): Record<string, unknown> {
  const timestamp = now.toISOString();
  switch (kind) {
    case "media": return { schema: "portable-media/v1", id: "asset-1", type: "image", storageProvider: "s3", storageBucket: "source", storageKey: "asset-1.png", mimeType: "image/png", sizeBytes: 100, width: 10, height: 10, durationSeconds: null, checksum: "sha256:asset", metadata: {}, createdAt: timestamp };
    case "content_revision": return { schema: "portable-content-revision/v1", id: "revision-1", workflowId: "workflow-1", revision: 1, definitionDigest: `sha256:${"1".repeat(64)}`, definition: { schema: "content-workflow-revision-definition/v1" }, operationRegistryDigest: `sha256:${"2".repeat(64)}`, createdAt: timestamp };
    case "prompt": return { schema: "portable-prompt/v1", id: "prompt-1", mode: "copy", name: "Launch", promptText: "Write", formConfig: {}, isPublic: false, createdAt: timestamp, updatedAt: timestamp };
    case "brand_source": return { schema: "portable-brand-source/v1", id: "brand-1", revision: 1, kind: "description", submittedUrl: null, finalUrl: null, submittedDescription: "Brand", cleanedText: "Brand", contentHash: "hash", sourceLanguage: "ar", extractedBytes: 5, fetchedAt: null, createdAt: timestamp };
    case "calendar_plan": return { schema: "portable-calendar-plan/v1", id: "post-1", sourceChannelId: "channel-1", status: "draft", kind: "post", content: "Copy", media: [], omittedRawMediaCount: 0, platformSettings: {}, scheduledAt: "2026-09-04T12:00:00.000Z", createdAt: timestamp, updatedAt: timestamp };
    case "caption": return { schema: "portable-caption/v1", id: "caption:post-1", sourcePostId: "post-1", text: "Copy", createdAt: timestamp, updatedAt: timestamp };
    case "platform_observation": return { schema: "portable-platform-observation/v1", id: "event-1", eventType: "post.published", severity: "info", userFacing: true, sourcePostId: "post-1", sourceChannelId: "channel-1", provider: "linkedin", createdAt: timestamp };
    case "platform_export_metadata": return { schema: "portable-platform-export-metadata/v1", id: "post-1", platform: "linkedin", sourceChannelId: "channel-1", platformPostId: "remote-1", platformPostUrl: "https://example.com/post/1", publishedAt: timestamp, createdAt: timestamp };
  }
}

describe("GovernanceImportWorker", () => {
  it("admits destination primary storage immediately before a portable media copy", async () => {
    const order: string[] = [];
    const admit = vi.fn(async () => { order.push("admit"); });
    const copy = vi.fn(async () => { order.push("copy"); });
    await copyPortableMediaIntoPrimaryStorage({ workspaceId: "workspace-a", sourceKey: "source/a.png", destinationKey: "destination/a.png", configuredRegion: "me-central-1" }, { admit, copy });
    expect(order).toEqual(["admit", "copy"]);
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-a", route: { kind: "primary_storage", routeId: "storage:workspace-assets" }, configuredRegion: "me-central-1" }));
  });

  it("rejects raw calendar media URLs and accepts digest-bound asset references", () => {
    const body = payload("calendar_plan");
    expect(validatePortablePayload("calendar_plan", { ...body, media: [{ type: "image", url: "https://source.example/private.png" }] })).toBeNull();
    expect(validatePortablePayload("calendar_plan", { ...body, media: [{ type: "image", sourceAssetId: "asset-1", assetDigest: `sha256:${"a".repeat(64)}` }] })).not.toBeNull();
  });

  it("derives server-copy authority only from an exact first-party Workspace export source", () => {
    expect(workspaceIdFromExportSource("workspace-export:source-workspace")).toBe("source-workspace");
    expect(workspaceIdFromExportSource("workspace-export:source-workspace:export-1")).toBe("source-workspace");
    expect(workspaceIdFromExportSource("workspace-export:../workspace-b")).toBeNull();
    expect(workspaceIdFromExportSource("platform-export:workspace-b")).toBeNull();
    expect(workspaceIdFromExportSource("workspace-export:workspace-b/object-key")).toBeNull();
  });

  it("materializes every canonical portable surface through its exact adapter with provenance", async () => {
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => new Date(now) }, undefined, undefined, { verify: () => true });
    const kinds: GovernancePortableKind[] = ["media", "content_revision", "prompt", "brand_source", "calendar_plan", "caption", "platform_observation", "platform_export_metadata"];
    const items = kinds.map((kind) => {
      const body = payload(kind);
      return { kind, sourceId: `${kind}-source`, destinationId: `${kind}-destination`, digest: canonicalDigest(body), transferable: true as const, payload: body };
    });
    const manifestDigest = canonicalDigest({ manifest: 1 });
    const preview = await service.execute(actor, { type: "preview_import", source: "workspace-export:source-workspace", sourceManifestDigest: manifestDigest, manifestKeyId: "trusted-test-key", manifestSignature: signature, items: [...items, { kind: "credential_material", sourceId: "credentials", digest: canonicalDigest({ omitted: true }), transferable: false, omissionReason: "secret material is never transferable" }] }, "preview-signed-import") as { importId: string };
    await service.execute(actor, { type: "execute_import", importId: preview.importId }, "execute-signed-import");
    const materialize = vi.fn(async (input: Parameters<GovernancePortableDataPort["materialize"]>[0]) => ({ kind: "created" as const, destinationId: input.destinationId }));
    const worker = new GovernanceImportWorker(repository, { now: () => new Date("2026-09-03T12:01:00.000Z") }, { list: async () => [], materialize });
    await worker.process({ workspaceId: actor.workspaceId, importId: preview.importId });
    await worker.process({ workspaceId: actor.workspaceId, importId: preview.importId });

    expect(materialize).toHaveBeenCalledTimes(kinds.length);
    expect(materialize.mock.calls.map(([input]) => input.kind)).toEqual(kinds);
    for (const [input] of materialize.mock.calls) expect(input).toMatchObject({ workspaceId: actor.workspaceId, requestedByUserId: actor.userId, provenance: { sourceManifestDigest: manifestDigest } });
    const job = await repository.getResource<{ items: Array<{ state: string; outcome: Record<string, unknown> }> }>({ workspaceId: actor.workspaceId, kind: "workspace_import", id: preview.importId });
    expect(job?.status).toBe("succeeded");
    expect(job?.body.items.map((item) => item.state)).toEqual([...kinds.map(() => "created"), "omitted"]);
  });

  it("rejects security-policy payloads before they can enter an import job", async () => {
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => new Date(now) }, undefined, undefined, { verify: () => true });
    const body = { revisions: [{ capabilities: ["workspace.close"] }] };
    await expect(service.execute(actor, { type: "preview_import", source: "workspace-export", sourceManifestDigest: canonicalDigest({ manifest: 2 }), manifestKeyId: "trusted-test-key", manifestSignature: signature, items: [{ kind: "custom_role", sourceId: "role-1", digest: canonicalDigest(body), transferable: true, payload: body }] }, "preview-security-import"))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("uses an exclusive lease and recovers only expired running imports", async () => {
    let current = new Date(now);
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => current }, undefined, undefined, { verify: () => true });
    const body = payload("prompt");
    const preview = await service.execute(actor, { type: "preview_import", source: "workspace-export", sourceManifestDigest: canonicalDigest({ manifest: 3 }), manifestKeyId: "trusted-test-key", manifestSignature: signature, items: [{ kind: "prompt", sourceId: "prompt-source", digest: canonicalDigest(body), transferable: true, payload: body }] }, "preview-lease-import") as { importId: string };
    await service.execute(actor, { type: "execute_import", importId: preview.importId }, "execute-lease-import");
    const materialize = vi.fn(async () => ({ kind: "created" as const, destinationId: "prompt-destination" }));
    const worker = new GovernanceImportWorker(repository, { now: () => current }, { list: async () => [], materialize });
    const first = worker.process({ workspaceId: actor.workspaceId, importId: preview.importId });
    const second = worker.process({ workspaceId: actor.workspaceId, importId: preview.importId });
    await Promise.all([first, second]);
    expect(materialize).toHaveBeenCalledTimes(1);
    current = new Date("2026-09-03T12:10:00.000Z");
    expect(await worker.recoverExpired({ workspaceId: actor.workspaceId })).toBe(0);
  });

  it("durably waits for exact destination mappings and resumes the same item", async () => {
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => new Date(now) }, undefined, undefined, { verify: () => true });
    const body = payload("calendar_plan");
    const preview = await service.execute(actor, {
      type: "preview_import", source: "workspace-export", sourceManifestDigest: canonicalDigest({ manifest: 4 }), manifestKeyId: "trusted-test-key", manifestSignature: signature,
      items: [{ kind: "calendar_plan", sourceId: "post-source", digest: canonicalDigest(body), transferable: true, payload: body }],
    }, "preview-mapped-import") as { importId: string };
    await service.execute(actor, { type: "execute_import", importId: preview.importId }, "execute-mapped-import");
    const materialize = vi.fn(async (input: Parameters<GovernancePortableDataPort["materialize"]>[0]) => input.mapping?.destinationChannelId
      ? { kind: "created" as const, destinationId: input.destinationId }
      : { kind: "waiting_user" as const, reason: "DESTINATION_CALENDAR_MAPPING_REQUIRED", requiredMappings: ["destinationChannelId"] });
    const worker = new GovernanceImportWorker(repository, { now: () => new Date("2026-09-03T12:01:00.000Z") }, { list: async () => [], materialize });

    await worker.process({ workspaceId: actor.workspaceId, importId: preview.importId });
    let job = await repository.getResource<{ items: Array<{ id: string; state: string; outcome: Record<string, unknown> }> }>({ workspaceId: actor.workspaceId, kind: "workspace_import", id: preview.importId });
    expect(job?.status).toBe("waiting_user");
    expect(job?.body.items[0]).toMatchObject({ state: "waiting_user", outcome: { requiredMappings: ["destinationChannelId"] } });

    await expect(service.execute(actor, { type: "provide_import_mapping", importId: preview.importId, itemId: job!.body.items[0].id, mapping: {} }, "missing-import-mapping"))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.execute(actor, { type: "provide_import_mapping", importId: preview.importId, itemId: job!.body.items[0].id, mapping: { destinationChannelId: "channel-target", sourceStorageKey: "another-workspace/private.png" } }, "untrusted-import-mapping"))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await service.execute(actor, { type: "provide_import_mapping", importId: preview.importId, itemId: job!.body.items[0].id, mapping: { destinationChannelId: "channel-target" } }, "provide-import-mapping");
    await worker.process({ workspaceId: actor.workspaceId, importId: preview.importId });
    job = await repository.getResource({ workspaceId: actor.workspaceId, kind: "workspace_import", id: preview.importId });
    expect(job?.status).toBe("succeeded");
    expect(materialize).toHaveBeenCalledTimes(2);
    expect(materialize.mock.calls[1]?.[0].mapping).toEqual({ destinationChannelId: "channel-target" });
  });
});
