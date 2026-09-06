import type { ContentFormat } from "./definitions";

export interface BlitzReplenishmentSource {
  id: string;
  format: ContentFormat;
  contentLanguage: "ar" | "en";
  rightsAdmitted: boolean;
  observedAt: Date;
  views: number;
  likes: number;
}

export interface BlitzReplenishmentPolicy {
  mode: "daily" | "manual";
  targetCapacity: number;
  maximumCreatesPerRun: number;
  prospectiveSpendCeilingCents: number;
  perProposalGenerationCeilingCents: number;
  remixRatio: number;
  executionMode: "byok" | "managed";
  contentLanguage: "ar" | "en";
  formatMix: Partial<Record<ContentFormat, number>>;
}

export function planBlitzReplenishment(input: {
  policy: BlitzReplenishmentPolicy;
  invocation: "daily" | "manual";
  sources: BlitzReplenishmentSource[];
  queuedCount: number;
  queuedRemixCount?: number;
  existingSourceIds: Set<string>;
  prospectiveCommittedCents: number;
  now: Date;
}) {
  const { policy } = input;
  if (policy.mode !== input.invocation && input.invocation !== "manual") return { selected: [] as BlitzReplenishmentSource[], stopReason: "mode_not_due" as const };
  const capacity = Math.max(0, Math.min(100, policy.targetCapacity) - input.queuedCount);
  const remixCapacity = Math.max(0, Math.ceil(Math.min(100, policy.targetCapacity) * Math.min(100, Math.max(0, policy.remixRatio)) / 100) - (input.queuedRemixCount ?? input.queuedCount));
  const budgetCapacity = policy.perProposalGenerationCeilingCents > 0 ? Math.floor(Math.max(0, policy.prospectiveSpendCeilingCents - input.prospectiveCommittedCents) / policy.perProposalGenerationCeilingCents) : 0;
  const limit = Math.min(capacity, remixCapacity, Math.max(0, Math.min(50, policy.maximumCreatesPerRun)), budgetCapacity);
  if (!capacity) return { selected: [] as BlitzReplenishmentSource[], stopReason: "capacity_reached" as const };
  if (!remixCapacity) return { selected: [] as BlitzReplenishmentSource[], stopReason: "remix_target_reached" as const };
  if (!budgetCapacity) return { selected: [] as BlitzReplenishmentSource[], stopReason: "spend_ceiling_reached" as const };
  const desired = Object.entries(policy.formatMix).filter((entry): entry is [ContentFormat, number] => typeof entry[1] === "number" && entry[1] > 0).sort(([left], [right]) => left.localeCompare(right));
  const eligible = input.sources.filter((source) => source.rightsAdmitted && source.contentLanguage === policy.contentLanguage && !input.existingSourceIds.has(source.id) && desired.some(([format]) => format === source.format));
  eligible.sort((left, right) => {
    const leftWeight = policy.formatMix[left.format] ?? 0; const rightWeight = policy.formatMix[right.format] ?? 0;
    const leftScore = leftWeight * 1_000_000 + Math.log10(left.views + 10) * 10_000 + Math.log10(left.likes + 10) * 1_000 - Math.floor((input.now.getTime() - left.observedAt.getTime()) / 86_400_000);
    const rightScore = rightWeight * 1_000_000 + Math.log10(right.views + 10) * 10_000 + Math.log10(right.likes + 10) * 1_000 - Math.floor((input.now.getTime() - right.observedAt.getTime()) / 86_400_000);
    return rightScore - leftScore || left.id.localeCompare(right.id);
  });
  return { selected: eligible.slice(0, limit), stopReason: eligible.length ? eligible.length <= limit ? "sources_exhausted" as const : "run_limit_reached" as const : "no_eligible_sources" as const };
}
