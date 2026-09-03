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
    getTelemetryConsent: vi.fn(async () => ({ schema: "product-telemetry-consent/v1", workspaceId: "workspace-1", userId: "owner-1", revision: 2, purpose: "product_analytics", status: "active", issuedAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000) })),
    setTelemetryConsent: vi.fn(async () => ({ consent: {}, replayed: false })),
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
    const safe = { schema: "product-telemetry-event/v1", eventId: "pte_abcdefgh", occurredAt: NOW.toISOString(), locale: "ar", direction: "rtl", buildId: "build-1", name: "generation_requested", properties: { mediaKind: "video", aspectRatio: "9:16", providerFamily: "replicate", brandProfileAttached: true } };
    await service.telemetry("workspace-1", "owner-1", "session-auth-context", safe, "request-key-3", NOW);
    expect(repo.appendTelemetry).toHaveBeenCalledWith(expect.objectContaining({ event: expect.objectContaining({ workspacePseudonym: expect.stringMatching(/^wsp_[a-f0-9]{64}$/), sessionPseudonym: expect.stringMatching(/^ses_[a-f0-9]{64}$/), consentRevision: "consent_r0002", consentPurpose: "product_analytics" }) }));
    await expect(service.telemetry("workspace-1", "owner-1", "session-auth-context", { ...safe, sessionPseudonym: `ses_${"a".repeat(32)}` }, "request-key-4", NOW)).rejects.toThrow("TELEMETRY_NOT_ALLOWLISTED");
    await expect(service.telemetry("workspace-1", "owner-1", "session-auth-context", { ...safe, properties: { ...safe.properties, prompt: "private" } }, "request-key-5", NOW)).rejects.toThrow();
  });

  it("rejects trusted release evidence on the generic Workspace endpoint", async () => {
    const service = new ReleaseControlService(repository(), "test-secret");
    await expect(service.append("workspace-1", "owner-1", { recordKind: "contract_migration", document: { id: "migration-2", contract: "generation/v2", buildId: "build-1", phase: "migrate", status: "verified", compatibilityVerified: true, rollbackVerified: true, observedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 1000).toISOString(), artifactDigest: `sha256:${"a".repeat(64)}`, predecessorId: "migration-1" } }, "request-key-6", NOW)).rejects.toThrow("TRUSTED_ATTESTATION_REQUIRED");
  });

  it("fails closed when active consent is absent", async () => {
    const repo = repository(); vi.mocked(repo.getTelemetryConsent).mockResolvedValue(null); const service = new ReleaseControlService(repo, "test-secret");
    await expect(service.telemetry("workspace-1", "owner-1", "auth-context", { schema: "product-telemetry-event/v1", eventId: "pte_abcdefgh", occurredAt: NOW.toISOString(), locale: "en", direction: "ltr", buildId: "build-1", name: "surface_viewed", properties: { surface: "dashboard", referrerKind: "direct" } }, "request-key-7", NOW)).rejects.toThrow("TELEMETRY_CONSENT_REQUIRED");
  });
});
