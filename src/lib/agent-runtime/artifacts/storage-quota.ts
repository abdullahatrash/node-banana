import type {
  ArtifactRecord,
  ArtifactStorageQuotaCommitPlan,
} from "./types";

export function storageQuotaPlanMatchesArtifact(input: {
  plan: ArtifactStorageQuotaCommitPlan;
  artifact: ArtifactRecord;
  runId: string | null;
}): boolean {
  const { plan, artifact, runId } = input;
  const expectedSubject = { kind: "artifact", id: artifact.id } as const;
  const expectedAmount = String(artifact.sizeBytes);
  const expectedReservationIds = plan.claim.reservations
    .map((item) => item.id)
    .sort();
  return (
    plan.claim.workspaceId === artifact.workspaceId &&
    plan.claim.principalId === artifact.creatorPrincipalId &&
    plan.claim.runId === runId &&
    plan.claim.transitionKey === `artifact:${artifact.id}:storage:create` &&
    plan.claim.boundary === "artifact_storage" &&
    plan.claim.subject.kind === expectedSubject.kind &&
    plan.claim.subject.id === expectedSubject.id &&
    plan.claim.claims.length === 1 &&
    plan.claim.claims[0]?.dimension === "runtime.artifact_bytes@1" &&
    plan.claim.claims[0]?.unit === "byte" &&
    plan.claim.claims[0]?.amount === expectedAmount &&
    plan.settle.workspaceId === artifact.workspaceId &&
    plan.settle.transitionId ===
      `artifact:${artifact.id}:storage:settled` &&
    plan.settle.subject.kind === expectedSubject.kind &&
    plan.settle.subject.id === expectedSubject.id &&
    plan.settle.outcome === "settle" &&
    plan.settle.amount === expectedAmount &&
    plan.settle.evidenceRef ===
      `artifact:${artifact.id}:canonical-created` &&
    JSON.stringify([...plan.settle.reservationIds].sort()) ===
      JSON.stringify(expectedReservationIds)
  );
}
