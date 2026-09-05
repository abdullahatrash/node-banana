import type { CreativeBrief } from "./brief";
import type { Composition, CreativeRequest, StructuredCopy } from "./contracts";
import type { CreativeRenderReceipt } from "./render";

export interface CreativeSession {
  schema: "creative-session/v1";
  id: string;
  workspaceId: string;
  revision: number;
  request: CreativeRequest;
  brief: CreativeBrief;
  copy: StructuredCopy | null;
  copyApproval: { digest: string; userId: string; acceptedAt: string } | null;
  composition: Composition | null;
  stages: Array<{ stage: "copy" | "visual"; attempt: number; intentId: string; operationId: string; model: { provider: string; model: string; version: string; inputSchemaDigest: string }; createdAt: string }>;
  plate: { assetId: string; digest: string; intentId: string } | null;
  visualReview: CreativeVisualReview | null;
  output: { assetId: string; digest: string; receipt: CreativeRenderReceipt } | null;
  publicationReview: { outputDigest: string; compositionDigest: string; userId: string; acceptedAt: string } | null;
  cancellationRequestedAt: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreativeVisualReview {
  schema: "creative-visual-review/v1";
  plateDigest: string;
  detection: { status: "clear" | "warning" | "rejected" | "unavailable"; detectorId: string | null; detectorVersion: string | null; evidenceDigest: string | null; findings: Array<{ kind: "text" | "watermark" | "protected_mark"; confidence: number }> };
  decision: "pending" | "accepted" | "rejected";
  reviewerUserId: string | null;
  reviewedAt: string | null;
  acknowledgedFindingsDigest: string | null;
}

export interface CreativeSessionStore {
  get(workspaceId: string, id: string): Promise<CreativeSession | null>;
  create(session: CreativeSession, idempotencyKey: string, requestDigest: string): Promise<CreativeSession>;
  mutate(input: { workspaceId: string; id: string; userId: string; expectedRevision: number; idempotencyKey: string; requestDigest: string }, change: (current: CreativeSession) => CreativeSession): Promise<CreativeSession>;
}
