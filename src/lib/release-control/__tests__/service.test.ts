import { describe, expect, it, vi } from "vitest";
import type { ReleaseControlRepository } from "../repository";
import { derivePublicServiceStatus, ReleaseControlService } from "../service";

const NOW = new Date("2026-09-03T12:00:00.000Z");
function repository() {
  return {
    append: vi.fn(async (input) => ({ record: { ...input, revision: 1, createdByUserId: input.userId, createdAt: input.now }, replayed: false })),
    appendTelemetry: vi.fn(async () => ({ replayed: false })),
    listLatest: vi.fn(async () => []),
    listPublicIncidents: vi.fn(async () => []),
    getTelemetryConsent: vi.fn(async () => ({ schema: "product-telemetry-consent/v1", workspaceId: "workspace-1", userId: "owner-1", revision: 2, purpose: "product_analytics", status: "active", issuedAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000) })),
    setTelemetryConsent: vi.fn(async () => ({ consent: {}, replayed: false })),
    getExperimentAssignment: vi.fn(async () => null),
    assignExperiment: vi.fn(async () => ({ assignment: {}, replayed: false })),
    hasExperimentExposure: vi.fn(async () => false),
    deleteExpiredTelemetry: vi.fn(async () => 0),
  } as unknown as ReleaseControlRepository;
}

describe("ReleaseControlService", () => {
  it("preserves minor, major, and critical public incident severity", () => {
    expect(derivePublicServiceStatus([{ severity: "minor", status: "monitoring" }])).toBe("degraded");
    expect(derivePublicServiceStatus([{ severity: "major", status: "identified" }])).toBe("majorOutage");
    expect(derivePublicServiceStatus([{ severity: "critical", status: "investigating" }])).toBe("criticalOutage");
    expect(derivePublicServiceStatus([{ severity: "critical", status: "resolved" }])).toBe("operational");
  });
  it("binds owner-controlled records to the authenticated operator", async () => {
    const service = new ReleaseControlService(repository(), "test-secret");
    await expect(service.append("workspace-1", "owner-1", { recordKind: "flag", document: { id: "flag-safe", buildId: "build-1", ownerUserId: "other-user", hypothesis: "A sufficiently explicit hypothesis", createdAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 1000).toISOString(), rolloutPercent: 0, safeDefault: "off", status: "active", evidenceIds: ["evidence-1"], eligibility: { roles: ["owner"], entitlements: ["pro"], locales: ["ar", "en"] }, dependencyFlagIds: [], telemetryEventName: "release_flag_evaluated", rollback: { mode: "automatic", triggerMetric: "error_rate", threshold: 0.1, windowMinutes: 15, ownerUserId: "other-user" } } }, "request-key-1", NOW)).rejects.toThrow("RELEASE_OWNER_MISMATCH");
  });

  it("rejects inconsistent incident transitions before persistence", async () => {
    const service = new ReleaseControlService(repository(), "test-secret");
    await expect(service.append("workspace-1", "owner-1", { recordKind: "incident", document: { id: "incident-1", severity: "major", status: "resolved", impactedServices: ["generation"], startedAt: NOW.toISOString(), resolvedAt: null, publicSummary: { ar: "تعطّل جزئي", en: "Partial disruption" }, operationOutcome: "blocked", creditRisk: "at_risk", publishingRisk: "delay" } }, "request-key-2", NOW)).rejects.toThrow("INCIDENT_STATE_INVALID");
  });

  it("derives the workspace pseudonym and rejects caller-supplied identifiers or free text", async () => {
    const repo = repository(); const service = new ReleaseControlService(repo, "test-secret");
    const safe = { schema: "product-telemetry-event/v1", eventId: "pte_abcdefgh", occurredAt: NOW.toISOString(), locale: "ar", direction: "rtl", buildId: "build-1", name: "generation_requested", properties: { mediaKind: "video", aspectRatio: "9:16", providerFamily: "replicate", brandProfileAttached: true } };
    await service.telemetry("workspace-1", "owner-1", "session-auth-context", "mena", safe, "request-key-3", NOW);
    expect(repo.appendTelemetry).toHaveBeenCalledWith(expect.objectContaining({ event: expect.objectContaining({ workspacePseudonym: expect.stringMatching(/^wsp_[a-f0-9]{64}$/), sessionPseudonym: expect.stringMatching(/^ses_[a-f0-9]{64}$/), consentRevision: "consent_r0002", consentPurpose: "product_analytics" }) }));
    await expect(service.telemetry("workspace-1", "owner-1", "session-auth-context", "mena", { ...safe, sessionPseudonym: `ses_${"a".repeat(32)}` }, "request-key-4", NOW)).rejects.toThrow("TELEMETRY_NOT_ALLOWLISTED");
    await expect(service.telemetry("workspace-1", "owner-1", "session-auth-context", "mena", { ...safe, properties: { ...safe.properties, prompt: "private" } }, "request-key-5", NOW)).rejects.toThrow();
    await expect(service.telemetry("workspace-1", "owner-1", "session-auth-context", "mena", { ...safe, direction: "ltr" }, "request-key-direction", NOW)).rejects.toThrow("locale direction");
  });

  it("rejects trusted release evidence on the generic Workspace endpoint", async () => {
    const service = new ReleaseControlService(repository(), "test-secret");
    await expect(service.append("workspace-1", "owner-1", { recordKind: "contract_migration", document: { id: "migration-2", contract: "generation/v2", buildId: "build-1", phase: "migrate", status: "verified", compatibilityVerified: true, rollbackVerified: true, observedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 1000).toISOString(), artifactDigest: `sha256:${"a".repeat(64)}`, predecessorId: "migration-1", resumable: true, cursorSchemaVersion: "v1", resumeCursorEvidenceDigest: `sha256:${"b".repeat(64)}`, compatibilityWindowStartsAt: NOW.toISOString(), compatibilityWindowEndsAt: new Date(NOW.getTime() + 1000).toISOString(), dryRunVerified: true, progressPercent: 100, failureCount: 0, pinnedDefinitionDigest: `sha256:${"c".repeat(64)}` } }, "request-key-6", NOW)).rejects.toThrow("TRUSTED_ATTESTATION_REQUIRED");
  });

  it("fails closed when active consent is absent", async () => {
    const repo = repository(); vi.mocked(repo.getTelemetryConsent).mockResolvedValue(null); const service = new ReleaseControlService(repo, "test-secret");
    await expect(service.telemetry("workspace-1", "owner-1", "auth-context", "non_mena", { schema: "product-telemetry-event/v1", eventId: "pte_abcdefgh", occurredAt: NOW.toISOString(), locale: "en", direction: "ltr", buildId: "build-1", name: "surface_viewed", properties: { surface: "dashboard", referrerKind: "direct" } }, "request-key-7", NOW)).rejects.toThrow("TELEMETRY_CONSENT_REQUIRED");
  });

  it("requires an active assignment and a prior exposure for experiment outcomes", async () => {
    const repo = repository(); const experiment = { id: "exp_checkout", buildId: "build-1", hypothesis: "Improve completion", variants: ["control", "treatment"], allocationPercent: 50, status: "active", startsAt: new Date(NOW.getTime() - 1000).toISOString(), expiresAt: new Date(NOW.getTime() + 60_000).toISOString(), ownerUserId: "owner-1", metric: "completion", guardrails: [{ metric: "error_rate", direction: "below", threshold: 0.05 }], evidenceIds: [] };
    vi.mocked(repo.listLatest).mockResolvedValue([{ workspaceId: "workspace-1", kind: "experiment", id: "exp_checkout", revision: 3, buildId: "build-1", document: experiment, createdByUserId: "owner-1", createdAt: NOW, expiresAt: new Date(experiment.expiresAt) }]);
    const service = new ReleaseControlService(repo, "test-secret"); const outcome = { schema: "product-telemetry-event/v1", eventId: "pte_outcome123", occurredAt: NOW.toISOString(), locale: "en", direction: "ltr", buildId: "build-1", name: "experiment_outcome", properties: { experimentId: "exp_checkout", assignmentRevision: 3, exposureEventId: "pte_exposure123", metric: "completion", value: 1, guardrailValues: [{ metric: "error_rate", value: 0.01 }] } };
    await expect(service.telemetry("workspace-1", "owner-1", "auth-context", "mena", outcome, "request-key-outcome-1", NOW)).rejects.toThrow("EXPERIMENT_ASSIGNMENT_REQUIRED");
    vi.mocked(repo.getExperimentAssignment).mockResolvedValue({ schema: "experiment-assignment/v1", workspaceId: "workspace-1", experimentId: "exp_checkout", subjectPseudonym: `sub_${"a".repeat(64)}`, assignmentRevision: 3, variant: "treatment", assignedAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000) });
    await expect(service.telemetry("workspace-1", "owner-1", "auth-context", "mena", outcome, "request-key-outcome-2", NOW)).rejects.toThrow("EXPERIMENT_EXPOSURE_REQUIRED");
  });
});
