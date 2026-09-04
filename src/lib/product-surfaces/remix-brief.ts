import "server-only";

import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { brandProfileV1Schema, type BrandProfileV1 } from "@/lib/onboarding/schemas";
import { brandAwareRemixBriefSchema, inspirationPayloadSchema, type BrandAwareRemixBrief } from "./definitions";

const VARIETY_LABELS = {
  msa: "Modern Standard Arabic / العربية الفصحى المعاصرة",
  gulf: "Gulf Arabic / العربية الخليجية",
  egyptian: "Egyptian Arabic / العربية المصرية",
  levantine: "Levantine Arabic / العربية الشامية",
  maghrebi: "Maghrebi Arabic / العربية المغاربية",
} as const;

function unique(values: string[], limit: number) {
  return [...new Set(values.map((value) => value.normalize("NFKC").trim()).filter(Boolean))].slice(0, limit);
}

function bounded(value: string, maximum = 500) { return value.slice(0, maximum).trim(); }

function directionFor(kind: "topic" | "hook" | "pacing" | "structure", source: ReturnType<typeof inspirationPayloadSchema.parse>, audience: string, angle: string) {
  if (kind === "topic") {
    const topics = unique([...source.creativePrimitives.topics, ...source.tags], 8);
    return topics.length ? `Explore the licensed topic signals: ${topics.join(", ")}.` : `Explore the Brand angle: ${angle}.`;
  }
  if (kind === "hook") return source.creativePrimitives.hookPattern
    ? `Use the licensed abstract hook pattern: ${source.creativePrimitives.hookPattern}. Write entirely original wording for ${audience}.`
    : `Create an entirely original opening for ${audience}; do not reproduce source wording.`;
  if (kind === "pacing") return source.creativePrimitives.pacing
    ? `Use the licensed abstract pacing direction: ${source.creativePrimitives.pacing}.`
    : `Use an original short-form rhythm appropriate for ${source.format}.`;
  return source.creativePrimitives.structure.length
    ? `Use only this licensed abstract sequence: ${source.creativePrimitives.structure.join(" → ")}. Create new scenes and wording.`
    : "Use an original sequence of audience problem, brand value, credible proof, payoff, and call to action.";
}

export function compileBrandAwareRemixBrief(input: {
  inspirationItemId: string;
  inspirationRevision: number;
  sourceValue: unknown;
  brand: { id: string; revision: number; acceptedAt: Date; profile: BrandProfileV1 };
  permittedRemix: "reference_only" | "transform" | "derivative";
  createdAt: Date;
}): BrandAwareRemixBrief {
  const source = inspirationPayloadSchema.parse(input.sourceValue);
  const profile = brandProfileV1Schema.parse(input.brand.profile);
  if (!source.rightsSnapshot) throw new Error("REMIX_BRIEF_RIGHTS_REQUIRED");
  if (source.contentLanguage === "ar" && !source.arabicVariety) throw new Error("REMIX_BRIEF_ARABIC_VARIETY_REQUIRED");
  const audience = [...profile.audiences].sort((left, right) => right.weight - left.weight)[0]!.description;
  const angle = profile.contentAngles[0] ?? profile.benefits[0] ?? profile.positioning;
  const offering = profile.offering[0]!;
  const influencePlan = [...new Set(source.permittedInfluence)].slice(0, 4).map((kind) => ({ kind, direction: bounded(directionFor(kind, source, audience, angle)) }));
  const languageDirection = source.contentLanguage === "ar"
    ? `Create the final content in ${VARIETY_LABELS[source.arabicVariety!]}. Preserve natural Arabic shaping and right-to-left reading order; keep mixed Arabic/Latin tokens in their correct bidi order.`
    : "Create the final content in English.";
  const callToAction = source.contentLanguage === "ar" ? "اختم بدعوة واضحة وملائمة لاتخاذ الإجراء دون ادعاءات غير موثقة." : "End with a clear, relevant call to action without unsupported claims.";
  const preserve = [
    `Brand identity: ${profile.identity.companyName} — ${profile.identity.coreIdentity}`,
    `Audience: ${audience}`,
    `Offering: ${offering}`,
    `Brand angle: ${angle}`,
    languageDirection,
    ...influencePlan.map((item) => item.direction),
  ].map((value) => bounded(value));
  const transform = input.permittedRemix !== "reference_only"
    ? ["Create new wording, scenes, composition, examples, and performance choices for this Brand.", "Make the result independently expressive and recognizably original."]
    : [];
  const avoid = unique([
    "Do not reproduce protected source wording, frames, audio, choreography, logos, likenesses, or distinctive scene composition.",
    ...profile.voice.doNot,
    ...profile.prohibitedClaims.map((value) => `Prohibited claim: ${value}`),
    ...profile.prohibitedTopics.map((value) => `Prohibited topic: ${value}`),
  ], 50).map((value) => bounded(value));
  const prompt = [
    languageDirection,
    `Create an original 9:16 ${source.format.replaceAll("_", " ")} concept for ${profile.identity.companyName}.`,
    `Audience: ${audience}`,
    `Offer: ${offering}`,
    `Creative angle: ${angle}`,
    `Voice: ${profile.voice.descriptors.join(", ")}.`,
    ...influencePlan.map((item) => `${item.kind}: ${item.direction}`),
    callToAction,
    "Protected expression from the source is excluded. Produce new wording, imagery, motion, audio, and scene composition.",
  ].join("\n");
  const unsigned = {
    schema: "brand-aware-remix-brief/v1" as const,
    brandProfile: { id: input.brand.id, revision: input.brand.revision, digest: canonicalDigest(profile) as `sha256:${string}`, acceptedAt: input.brand.acceptedAt.toISOString() },
    source: { inspirationItemId: input.inspirationItemId, revision: input.inspirationRevision, evidenceDigest: source.trendEvidence?.source.observationDigest ?? null, rightsSnapshotDigest: source.rightsSnapshot.digest },
    locale: { contentLanguage: source.contentLanguage, arabicVariety: source.arabicVariety },
    influencePlan,
    brandDirection: { audience, angle, voice: profile.voice.descriptors, offering, callToAction },
    provider: { prompt, preserve, transform, avoid },
    protectedExpressionExcluded: true as const,
    createdAt: input.createdAt.toISOString(),
  };
  return brandAwareRemixBriefSchema.parse({ ...unsigned, digest: canonicalDigest(unsigned) });
}

export function remixBriefProviderContract(value: unknown) {
  const brief = brandAwareRemixBriefSchema.parse(value);
  return { prompt: brief.provider.prompt, remixBrief: { preserve: brief.provider.preserve, transform: brief.provider.transform, avoid: brief.provider.avoid }, digest: brief.digest };
}
