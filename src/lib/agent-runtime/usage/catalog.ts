import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { PricingSnapshot } from "./types";

const EFFECTIVE_FROM = new Date("2026-08-01T00:00:00.000Z");
const SOURCE_URL = "https://ai.google.dev/gemini-api/docs/pricing";

type Entry = Omit<PricingSnapshot, "id" | "recordedAt">;

const ENTRIES: Entry[] = [
  ["gemini-2.5-flash", "gemini.tokens.input@1", "0.0000003"],
  ["gemini-2.5-flash", "gemini.tokens.output@1", "0.0000025"],
  ["gemini-2.5-flash-image", "gemini.tokens.input@1", "0.0000003"],
  ["gemini-2.5-flash-image", "gemini.tokens.output@1", "0.00003"],
].map(([model, dimension, price]) => ({
  schema: "pricing-snapshot/v1" as const,
  workspaceId: null,
  source: "builtin_catalog" as const,
  provider: "gemini",
  providerOperation: "generativelanguage.v1beta.models.generateContent",
  model,
  dimension,
  unit: "count" as const,
  price,
  currency: "USD",
  perQuantity: "1",
  version: "google-gemini-pricing-2026-08-01",
  sourceUrl: SOURCE_URL,
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
}));

export function builtinPricingSnapshots(input: {
  provider: string;
  providerOperation: string;
  model: string;
  at: Date;
}): PricingSnapshot[] {
  return ENTRIES.filter(
    (entry) =>
      entry.provider === input.provider &&
      entry.providerOperation === input.providerOperation &&
      entry.model === input.model &&
      entry.effectiveFrom <= input.at &&
      (!entry.effectiveTo || entry.effectiveTo > input.at),
  ).map((entry) => ({
    ...entry,
    id: `price_${canonicalDigest({ ...entry, effectiveFrom: entry.effectiveFrom.toISOString() }).slice(7, 39)}`,
    recordedAt: EFFECTIVE_FROM,
  }));
}
