import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { ExactModelRef, ModelDescriptor } from "@/lib/model-routing/types";
import type { ContentFormat } from "./definitions";
import type { ContentFormatDefinition } from "./content-format-definition";

export interface ContentModelPolicy {
  schema: "content-model-policy/v1"; id: string; revision: number; format: ContentFormat; region: "replicate-us";
  defaultModel: ExactModelRef & { provider: "replicate" };
  compatibleModels: Array<ExactModelRef & { provider: "replicate" }>;
  overrides: { mode: "explicit_exact_allowlist"; allowedFields: readonly ["model"]; requireRequote: true };
  digest: `sha256:${string}`;
}

const MODEL_ALLOWLIST: Record<Exclude<ContentFormat, "custom_upload">, readonly string[]> = {
  slideshow: ["prunaai/p-video", "google/veo-3.1-lite", "bytedance/seedance-2.0"],
  wall_of_text: ["wan-video/wan-2.7-videoedit", "kwaivgi/kling-v3-omni-video"],
  video_hook_demo: ["kwaivgi/kling-v3-omni-video", "wan-video/wan-2.7-videoedit"],
  speaking_hook_demo: ["kwaivgi/kling-v3-omni-video"],
  talking_head_ugc: ["google/veo-3.1-lite", "bytedance/seedance-2.0"],
  green_screen_meme: ["wan-video/wan-2.7-videoedit"],
  talking_head_green_screen: ["kwaivgi/kling-v3-omni-video"],
  product_spokesperson: ["google/veo-3.1-lite"],
  green_screen_mobile_app: ["prunaai/p-video", "bytedance/seedance-2.0"],
  claymation: ["bytedance/seedance-2.0"],
  character_swap: ["wan-video/wan-2.7-videoedit"],
};

export function resolveContentModelPolicy(definition: ContentFormatDefinition, catalog: readonly ModelDescriptor[]): ContentModelPolicy | null {
  if (definition.format === "custom_upload" || !definition.execution.modelPolicy || definition.execution.modelPolicy.revision !== 3 || definition.execution.modelPolicy.id !== `content.${definition.format}.v3` || !definition.execution.capability) return null;
  const allowed = MODEL_ALLOWLIST[definition.format].flatMap((model) => {
    const descriptor = catalog.find((item) => item.provider === "replicate" && item.model === model && item.capabilities.includes(definition.execution.capability!) && item.verifiedRegions.includes("replicate-us") && item.qualification.status === "qualified");
    return descriptor?.qualification.status === "qualified" ? [{ provider: "replicate" as const, model: descriptor.model, version: descriptor.qualification.version, inputSchemaDigest: descriptor.qualification.inputSchemaDigest }] : [];
  });
  if (!allowed[0]) return null;
  const unsigned = { schema: "content-model-policy/v1" as const, id: definition.execution.modelPolicy.id, revision: 3, format: definition.format, region: "replicate-us" as const, defaultModel: allowed[0], compatibleModels: allowed, overrides: { mode: "explicit_exact_allowlist" as const, allowedFields: ["model"] as const, requireRequote: true as const } };
  return { ...unsigned, digest: canonicalDigest(unsigned) as `sha256:${string}` };
}

export function contentModelAllowed(policy: ContentModelPolicy, model: ExactModelRef): boolean {
  return policy.compatibleModels.some((candidate) => candidate.provider === model.provider && candidate.model === model.model && candidate.version === model.version && candidate.inputSchemaDigest === model.inputSchemaDigest);
}

export function validateContentModelPolicy(policy: ContentModelPolicy): boolean {
  const { digest, ...unsigned } = policy;
  return policy.schema === "content-model-policy/v1" && policy.region === "replicate-us" && policy.overrides.mode === "explicit_exact_allowlist" && policy.overrides.requireRequote === true && canonicalDigest(unsigned) === digest && contentModelAllowed(policy, policy.defaultModel);
}
