export type MutableContractEvidenceResourceKind =
  | "run"
  | "budget_reservation"
  | "quota_reservation"
  | "quota_wait";

export type MutableContractEvidenceProjectionKind =
  | "run_summary"
  | "budget_summary"
  | "quota_reservation_summary"
  | "quota_wait_summary";

export interface ContractEvidenceVersionRecord {
  workspaceId: string;
  resourceKind: MutableContractEvidenceResourceKind;
  resourceId: string;
  version: number;
  canonicalDigest: `sha256:${string}`;
  projectionKind: MutableContractEvidenceProjectionKind;
  projection: Record<string, unknown>;
  projectionDigest: `sha256:${string}`;
  createdAt: Date;
}

export interface AppendContractEvidenceVersionInput {
  workspaceId: string;
  resourceKind: MutableContractEvidenceResourceKind;
  resourceId: string;
  canonicalSource: unknown;
  projectionKind: MutableContractEvidenceProjectionKind;
  projection: Record<string, unknown>;
  createdAt: Date;
}
