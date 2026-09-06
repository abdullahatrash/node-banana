import "server-only";
import { z } from "zod";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { readConfiguredSecret } from "@/lib/configured-secret";

export type ReferralPayoutProviderInput = {
  payoutRequestId: string;
  providerIdempotencyKey: string;
  payoutProvider: string;
  providerRecipientRef: string;
  amountMinor: number;
  currency: string;
  requestEvidenceDigest: string;
};

export type ReferralPayoutProviderOutcome = {
  state: "processing" | "action_required" | "paid" | "failed_known" | "outcome_unknown" | "cancelled";
  providerEventRef: string;
  merchantPayoutRef: string | null;
  evidenceDigest: string;
  occurredAt: Date;
};

export type ReferralPayoutProviderResult =
  | { kind: "outcome"; outcome: ReferralPayoutProviderOutcome }
  | { kind: "not_found" }
  | { kind: "retryable"; code: string }
  | { kind: "unavailable"; code: string };

export interface ReferralPayoutProvider {
  isConfigured(): boolean;
  lookup(input: ReferralPayoutProviderInput): Promise<ReferralPayoutProviderResult>;
  submit(input: ReferralPayoutProviderInput): Promise<ReferralPayoutProviderResult>;
}

type Environment = Record<string, string | undefined>;
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const providerResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    schema: z.literal("referral-payout-gateway/v1"),
    kind: z.literal("not_found"),
    provider: z.string().min(1).max(80),
    idempotencyKey: z.string().min(1).max(500),
    payoutRequestId: z.string().min(1).max(500),
    amountMinor: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    requestEvidenceDigest: digest,
  }).strict(),
  z.object({
    schema: z.literal("referral-payout-gateway/v1"),
    kind: z.literal("outcome"),
    provider: z.string().min(1).max(80),
    idempotencyKey: z.string().min(1).max(500),
    payoutRequestId: z.string().min(1).max(500),
    amountMinor: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    requestEvidenceDigest: digest,
    outcome: z.object({
      state: z.enum(["processing", "action_required", "paid", "failed_known", "outcome_unknown", "cancelled"]),
      providerEventRef: z.string().min(1).max(500),
      merchantPayoutRef: z.string().min(1).max(500).nullable(),
      evidenceDigest: digest,
      occurredAt: z.string().datetime({ offset: true }),
    }).strict(),
  }).strict(),
]);

function configuredEndpoint(environment: Environment) {
  const token = readConfiguredSecret(environment.REFERRAL_PAYOUT_GATEWAY_TOKEN);
  const provider = environment.REFERRAL_PAYOUT_PROVIDER_NAME?.trim();
  const rawUrl = environment.REFERRAL_PAYOUT_GATEWAY_URL?.trim();
  if (!token || !provider || !/^[a-z][a-z0-9._-]{0,79}$/i.test(provider) || !rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const loopback = new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.hash || url.search) return null;
    return { token, provider, url };
  } catch {
    return null;
  }
}

function boundedTimeout(value: string | undefined) {
  const parsed = Number(value ?? "15000");
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1_000), 30_000) : 15_000;
}

function unknownOutcome(input: ReferralPayoutProviderInput, provider: string, action: "lookup" | "submit", code: string): ReferralPayoutProviderResult {
  if (action === "lookup") return { kind: "retryable", code };
  const evidenceDigest = canonicalDigest({ schema: "referral-payout-gateway-ambiguity/v1", provider, idempotencyKey: input.providerIdempotencyKey, action, code });
  return {
    kind: "outcome",
    outcome: {
      state: "outcome_unknown",
      providerEventRef: `node-banana:gateway-unknown:${evidenceDigest.slice("sha256:".length)}`,
      merchantPayoutRef: null,
      evidenceDigest,
      occurredAt: new Date(),
    },
  };
}

export class ConfiguredReferralPayoutProvider implements ReferralPayoutProvider {
  constructor(
    private readonly environment: Environment = process.env,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  isConfigured() {
    return configuredEndpoint(this.environment) !== null;
  }

  lookup(input: ReferralPayoutProviderInput) {
    return this.request("lookup", input);
  }

  submit(input: ReferralPayoutProviderInput) {
    return this.request("submit", input);
  }

  private async request(action: "lookup" | "submit", input: ReferralPayoutProviderInput): Promise<ReferralPayoutProviderResult> {
    const configured = configuredEndpoint(this.environment);
    if (!configured) return { kind: "unavailable", code: "REFERRAL_PAYOUT_GATEWAY_NOT_CONFIGURED" };
    if (input.payoutProvider !== configured.provider) return { kind: "unavailable", code: "REFERRAL_PAYOUT_PROVIDER_MISMATCH" };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), boundedTimeout(this.environment.REFERRAL_PAYOUT_GATEWAY_TIMEOUT_MS));
    try {
      const response = await this.fetcher(configured.url, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${configured.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schema: "referral-payout-command/v1",
          action,
          provider: input.payoutProvider,
          idempotencyKey: input.providerIdempotencyKey,
          payoutRequestId: input.payoutRequestId,
          providerRecipientRef: input.providerRecipientRef,
          amountMinor: input.amountMinor,
          currency: input.currency,
          requestEvidenceDigest: input.requestEvidenceDigest,
        }),
      });
      if (!response.ok) return unknownOutcome(input, configured.provider, action, `REFERRAL_PAYOUT_GATEWAY_HTTP_${response.status}`);
      const text = await response.text();
      if (text.length > 65_536) return unknownOutcome(input, configured.provider, action, "REFERRAL_PAYOUT_GATEWAY_RESPONSE_TOO_LARGE");
      let value: unknown;
      try { value = JSON.parse(text); } catch { return unknownOutcome(input, configured.provider, action, "REFERRAL_PAYOUT_GATEWAY_RESPONSE_INVALID"); }
      const parsed = providerResponseSchema.safeParse(value);
      if (!parsed.success || parsed.data.provider !== configured.provider || parsed.data.idempotencyKey !== input.providerIdempotencyKey || parsed.data.payoutRequestId !== input.payoutRequestId || parsed.data.amountMinor !== input.amountMinor || parsed.data.currency !== input.currency || parsed.data.requestEvidenceDigest !== input.requestEvidenceDigest) {
        return unknownOutcome(input, configured.provider, action, "REFERRAL_PAYOUT_GATEWAY_RESPONSE_INVALID");
      }
      if (parsed.data.kind === "not_found") {
        return action === "lookup" ? { kind: "not_found" } : unknownOutcome(input, configured.provider, action, "REFERRAL_PAYOUT_SUBMIT_NOT_FOUND");
      }
      if (parsed.data.outcome.state === "paid" && !parsed.data.outcome.merchantPayoutRef) {
        return unknownOutcome(input, configured.provider, action, "REFERRAL_PAYOUT_PAID_REFERENCE_MISSING");
      }
      return {
        kind: "outcome",
        outcome: {
          ...parsed.data.outcome,
          providerEventRef: `${configured.provider}:${parsed.data.outcome.providerEventRef}`,
          merchantPayoutRef: parsed.data.outcome.merchantPayoutRef ? `${configured.provider}:${parsed.data.outcome.merchantPayoutRef}` : null,
          occurredAt: new Date(parsed.data.outcome.occurredAt),
        },
      };
    } catch (error) {
      const code = error instanceof Error && error.name === "AbortError"
        ? "REFERRAL_PAYOUT_GATEWAY_TIMEOUT"
        : "REFERRAL_PAYOUT_GATEWAY_TRANSPORT_UNKNOWN";
      return unknownOutcome(input, configured.provider, action, code);
    } finally {
      clearTimeout(timeout);
    }
  }
}
