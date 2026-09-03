import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";

export interface WorkflowRunAcceptedSpendQuote {
  schema: "workflow-run-accepted-spend-quote/v1";
  quoteId: string;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  requestedByUserId: string;
  delegatedPrincipalId: string;
  delegatedKeyId: string;
  capability: "workflow_runs.start@2";
  workflowId: string;
  workflowRevisionId: string;
  inputDigest: string;
  targetStateDigest: string;
  amount: string;
  currency: string;
  providerModels: Array<{
    provider: string;
    model: string;
    pricePerAttempt: string;
    automaticAttempts: number;
    pricingSnapshotIds: string[];
  }>;
  pricingSnapshotIds: string[];
  ceilingDigest: string;
  quotedAt: string;
  expiresAt: string;
}

export function workflowRunQuoteInputDigest(input: {
  workflowId: string;
  revisionId: string;
  inputs: Record<string, unknown>;
  inputArtifactIds: string[];
}): string {
  return canonicalDigest({
    workflowId: input.workflowId,
    revisionId: input.revisionId,
    inputs: input.inputs,
    inputArtifactIds: [...input.inputArtifactIds].sort(),
  });
}

export function workflowRunQuoteCeilingDigest(input: Pick<WorkflowRunAcceptedSpendQuote, "amount" | "currency" | "providerModels" | "pricingSnapshotIds">): string {
  return canonicalDigest({
    amount: input.amount,
    currency: input.currency,
    providerModels: input.providerModels,
    pricingSnapshotIds: [...input.pricingSnapshotIds].sort(),
  });
}

/** Authentication codec only. Callers must independently validate every exact
 * Workspace, Agent, Workflow, input, target-state, price and expiry binding. */
export class WorkflowRunSpendQuoteCodec {
  constructor(private readonly key: Uint8Array | null) {}

  seal(payload: WorkflowRunAcceptedSpendQuote): string {
    if (!this.key) throw new Error("Workflow Run spend quote signing key is unavailable.");
    const encoded = Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
    return `${encoded}.${createHmac("sha256", this.key).update(encoded).digest("base64url")}`;
  }

  open(ref: string): WorkflowRunAcceptedSpendQuote | null {
    if (!this.key) return null;
    const [encoded, signature, extra] = ref.split(".");
    if (!encoded || !signature || extra) return null;
    const expected = createHmac("sha256", this.key).update(encoded).digest();
    let supplied: Buffer;
    try { supplied = Buffer.from(signature, "base64url"); } catch { return null; }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    try {
      const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as WorkflowRunAcceptedSpendQuote;
      if (
        value.schema !== "workflow-run-accepted-spend-quote/v1" ||
        value.capability !== "workflow_runs.start@2" ||
        typeof value.quoteId !== "string" ||
        !value.quoteId.startsWith("quote_") ||
        workflowRunQuoteCeilingDigest(value) !== value.ceilingDigest
      ) return null;
      return value;
    } catch { return null; }
  }
}

export function productionWorkflowRunSpendQuoteCodec(): WorkflowRunSpendQuoteCodec {
  const key = Buffer.from(process.env.GOVERNANCE_BULK_QUOTE_SIGNING_KEY ?? "", "base64");
  return new WorkflowRunSpendQuoteCodec(key.length === 32 ? key : null);
}
