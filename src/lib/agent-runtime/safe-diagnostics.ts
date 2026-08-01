import { recordOperationalTrace } from "./observability/production";
import type { DiagnosticTrace } from "./observability/types";

const OPERATOR_TRACE_REF = /^otr_[a-f0-9]{32}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

export type SafeOperationalDiagnostic = Omit<
  DiagnosticTrace,
  "schema" | "operatorTraceRef" | "expiresAt" | "workspaceId"
> & {
  workspaceId: string | null | undefined;
};

/**
 * Records an allowlist-only diagnostic. Observability is best-effort: callers
 * receive a reference only after durable persistence and never replace their
 * canonical result or error when retention or persistence is unavailable.
 */
export async function recordSafeOperationalTrace(
  input: SafeOperationalDiagnostic,
): Promise<string | null> {
  if (!input.workspaceId || !SAFE_CODE.test(input.code)) return null;

  let operatorTraceRef: string | null = null;
  try {
    operatorTraceRef = await recordOperationalTrace({
      workspaceId: input.workspaceId,
      category: input.category,
      severity: input.severity,
      code: input.code,
      stage: input.stage,
      outcome: input.outcome,
      providerFamily: input.providerFamily,
      httpStatus: input.httpStatus,
      retryable: input.retryable,
      durationMs: input.durationMs,
      attempt: input.attempt,
      createdAt: new Date(input.createdAt),
    });
  } catch {
    return null;
  }

  return operatorTraceRef && OPERATOR_TRACE_REF.test(operatorTraceRef)
    ? operatorTraceRef
    : null;
}
