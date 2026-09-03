import { describe, expect, it, vi } from "vitest";
import type { ReleaseControlRepository } from "../repository";
import { ReleaseControlService } from "../service";

const NOW = new Date("2026-09-03T12:00:00.000Z");
function repository() {
  return {
    append: vi.fn(async (input) => ({ record: { ...input, revision: 1, createdByUserId: input.userId, createdAt: input.now }, replayed: false })),
    appendTelemetry: vi.fn(async () => ({ replayed: false })),
    listLatest: vi.fn(async () => []),
    listPublicIncidents: vi.fn(async () => []),
  } as unknown as ReleaseControlRepository;
}

describe("ReleaseControlService", () => {
  it("binds owner-controlled records to the authenticated operator", async () => {
    const service = new ReleaseControlService(repository(), "test-secret");
    await expect(service.append("workspace-1", "owner-1", { recordKind: "flag", document: { id: "flag-safe", ownerUserId: "other-user", hypothesis: "A sufficiently explicit hypothesis", createdAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 1000).toISOString(), rolloutPercent: 0, safeDefault: "off", status: "active", evidenceIds: ["evidence-1"] } }, "request-key-1", NOW)).rejects.toThrow("RELEASE_OWNER_MISMATCH");
  });

  it("rejects inconsistent incident transitions before persistence", async () => {
    const service = new ReleaseControlService(repository(), "test-secret");
    await expect(service.append("workspace-1", "owner-1", { recordKind: "incident", document: { id: "incident-1", severity: "major", status: "resolved", impactedServices: ["generation"], startedAt: NOW.toISOString(), resolvedAt: null, publicSummary: { ar: "تعطّل جزئي", en: "Partial disruption" } } }, "request-key-2", NOW)).rejects.toThrow("INCIDENT_STATE_INVALID");
  });

  it("derives the workspace pseudonym and rejects caller-supplied identifiers or free text", async () => {
    const repo = repository(); const service = new ReleaseControlService(repo, "test-secret");
    const safe = { schema: "product-telemetry-event/v1", eventId: "pte_abcdefgh", sessionPseudonym: `ses_${"b".repeat(32)}`, occurredAt: NOW.toISOString(), locale: "ar", direction: "rtl", consentRevision: "consent_rev1", buildId: "build-1", name: "generation_requested", properties: { mediaKind: "video", aspectRatio: "9:16", providerFamily: "replicate", brandProfileAttached: true } };
    await service.telemetry("workspace-1", safe, "request-key-3", NOW);
    expect(repo.appendTelemetry).toHaveBeenCalledWith(expect.objectContaining({ event: expect.objectContaining({ workspacePseudonym: expect.stringMatching(/^wsp_[a-f0-9]{64}$/) }) }));
    await expect(service.telemetry("workspace-1", { ...safe, workspacePseudonym: `wsp_${"a".repeat(32)}` }, "request-key-4", NOW)).rejects.toThrow("TELEMETRY_NOT_ALLOWLISTED");
    await expect(service.telemetry("workspace-1", { ...safe, properties: { ...safe.properties, prompt: "private" } }, "request-key-5", NOW)).rejects.toThrow();
  });

  it("does not admit migrate or contract phases without a verified predecessor", async () => {
    const service = new ReleaseControlService(repository(), "test-secret");
    await expect(service.append("workspace-1", "owner-1", { recordKind: "contract_migration", document: { id: "migration-2", contract: "generation/v2", buildId: "build-1", phase: "migrate", status: "verified", compatibilityVerified: true, rollbackVerified: true, observedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 1000).toISOString(), artifactDigest: `sha256:${"a".repeat(64)}`, predecessorId: "migration-1" } }, "request-key-6", NOW)).rejects.toThrow("MIGRATION_PREDECESSOR_UNVERIFIED");
  });
});
