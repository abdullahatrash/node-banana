import {
  ProviderTransportFault,
  type ProviderAdapterTransport,
  type ProviderEffectDisposition,
  type ProviderTransportEffectRequest,
  type ProviderTransportObservationRequest,
  type ProviderTransportResponse,
} from "../provider-adapter";

export type ProviderFaultStep =
  | {
      kind: "response";
      effectDisposition: ProviderEffectDisposition;
      providerOperationRef: string | null;
      response: ProviderTransportResponse;
    }
  | {
      kind: "timeout" | "disconnect";
      effectDisposition: ProviderEffectDisposition;
      providerOperationRef: string | null;
      retryAfterMs?: number | null;
    };

export interface ProviderEffectLedgerRecord {
  effectKey: string;
  intentDigest: string;
  providerOperationRef: string | null;
  state: "pending" | "succeeded" | "failed" | "unknown";
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stateFor(step: ProviderFaultStep): ProviderEffectLedgerRecord["state"] {
  if (step.effectDisposition === "terminal_failed") return "failed";
  if (step.effectDisposition === "unknown") return "unknown";
  if (step.effectDisposition === "not_created") return "unknown";
  if (step.kind !== "response") return "unknown";
  const body = step.response.body;
  if (!body || typeof body !== "object") return "unknown";
  const state = (body as Record<string, unknown>).state;
  return state === "succeeded" || state === "failed" || state === "pending"
    ? state
    : "unknown";
}

export class DeterministicProviderFaultKit
  implements ProviderAdapterTransport
{
  private readonly launchSteps: ProviderFaultStep[] = [];
  private readonly observationSteps: ProviderFaultStep[] = [];
  private readonly ledger = new Map<string, ProviderEffectLedgerRecord>();
  readonly launchCalls: ProviderTransportEffectRequest[] = [];
  readonly observationCalls: ProviderTransportObservationRequest[] = [];

  enqueueLaunch(...steps: ProviderFaultStep[]): void {
    this.launchSteps.push(...steps.map(clone));
  }

  enqueueObservation(...steps: ProviderFaultStep[]): void {
    this.observationSteps.push(...steps.map(clone));
  }

  get createdEffectCount(): number {
    return this.ledger.size;
  }

  effects(): ProviderEffectLedgerRecord[] {
    return [...this.ledger.values()].map(clone);
  }

  async launch(
    request: ProviderTransportEffectRequest,
  ): Promise<ProviderTransportResponse> {
    this.launchCalls.push(clone(request));
    const existing = this.ledger.get(request.effectKey);
    if (existing && existing.intentDigest !== request.intentDigest) {
      throw new ProviderTransportFault(
        "idempotency_conflict",
        "not_created",
        existing.providerOperationRef,
      );
    }
    const step = this.launchSteps.shift();
    if (!step) {
      throw new TypeError("No deterministic provider launch step remains.");
    }
    this.recordEffect(request, step);
    if (step.kind !== "response") {
      throw new ProviderTransportFault(
        step.kind,
        step.effectDisposition,
        step.providerOperationRef,
        step.retryAfterMs ?? null,
      );
    }
    return clone(step.response);
  }

  async observe(
    request: ProviderTransportObservationRequest,
  ): Promise<ProviderTransportResponse> {
    this.observationCalls.push(clone(request));
    const existing = this.ledger.get(request.effectKey);
    if (
      !existing ||
      existing.intentDigest !== request.intentDigest ||
      (existing.providerOperationRef !== null &&
        existing.providerOperationRef !== request.providerOperationRef)
    ) {
      throw new ProviderTransportFault(
        "idempotency_conflict",
        "unknown",
        request.providerOperationRef,
      );
    }
    const step = this.observationSteps.shift();
    if (!step) {
      throw new TypeError("No deterministic provider observation step remains.");
    }
    this.recordEffect(request, step);
    if (step.kind !== "response") {
      throw new ProviderTransportFault(
        step.kind,
        step.effectDisposition,
        step.providerOperationRef,
        step.retryAfterMs ?? null,
      );
    }
    return clone(step.response);
  }

  private recordEffect(
    request: ProviderTransportEffectRequest,
    step: ProviderFaultStep,
  ): void {
    if (step.effectDisposition === "not_created") return;
    const existing = this.ledger.get(request.effectKey);
    if (existing) {
      existing.providerOperationRef ??= step.providerOperationRef;
      existing.state = stateFor(step);
      return;
    }
    this.ledger.set(request.effectKey, {
      effectKey: request.effectKey,
      intentDigest: request.intentDigest,
      providerOperationRef: step.providerOperationRef,
      state: stateFor(step),
    });
  }
}

export function providerResponse(
  body: unknown,
  options: { status?: number; requestId?: string | null } = {},
): ProviderTransportResponse {
  return {
    status: options.status ?? 200,
    requestId: options.requestId ?? "request_conformance_1",
    body: clone(body),
  };
}
