export class ObservabilityError extends Error {
  constructor(readonly code: "OBSERVABILITY_INVALID_INPUT" | "OBSERVABILITY_CONFLICT" | "OBSERVABILITY_UNAVAILABLE" | "OBSERVABILITY_FORBIDDEN", message: string) {
    super(message);
    this.name = "ObservabilityError";
  }
}
