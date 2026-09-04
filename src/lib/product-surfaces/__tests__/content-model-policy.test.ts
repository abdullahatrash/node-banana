import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "@/lib/model-routing/types";
import { contentFormatDefinition } from "../content-format-definition";
import { contentModelAllowed, resolveContentModelPolicy } from "../content-model-policy";

function qualified(model: string, capability: "image_to_video" | "text_to_video" | "video_to_video", version: string): ModelDescriptor {
  return { provider: "replicate", model, label: model, capabilities: [capability], quality: "standard", contentLanguages: ["ar", "en", "mixed"], arabicVarieties: ["msa", "gulf", "egyptian", "levantine", "maghrebi"], verifiedRegions: ["replicate-us"], executionModes: ["async"], aspectRatios: ["9:16"], priceUsd: { basis: "second", amount: 0.01 }, lane: "final", qualification: { status: "qualified", endpoint: "versioned", version, inputSchemaDigest: `sha256:${"a".repeat(64)}`, executionPriceUsd: { basis: "second", amount: 0.01 }, maxQuantity: 60, cancelAfterSeconds: 600, outputShape: { width: 1080, height: 1920, fps: 30 }, inputContract: { promptKey: "prompt", aspectRatioKey: "aspect_ratio", quantityKey: "duration", imageKey: "image", imageMode: "array", safety: { parameterKey: "safe", safeValue: true }, lockedParameters: { safe: true } }, evidence: {} as never } };
}

describe("Content Model Policy", () => {
  it("persists an exact signed-qualified default and explicit compatible allowlist", () => {
    const policy = resolveContentModelPolicy(contentFormatDefinition("slideshow"), [qualified("prunaai/p-video", "image_to_video", "pinned-v1"), qualified("google/veo-3.1-lite", "image_to_video", "pinned-v2")]);
    expect(policy).toMatchObject({ id: "content.slideshow.v4", revision: 4, region: "replicate-us", defaultModel: { model: "prunaai/p-video", version: "pinned-v1" }, overrides: { mode: "explicit_exact_allowlist", requireRequote: true } });
    expect(policy?.compatibleModels).toHaveLength(2);
  });

  it("rejects an arbitrary qualified model even when its capability is compatible", () => {
    const allowed = qualified("prunaai/p-video", "image_to_video", "pinned-v1");
    const arbitrary = qualified("vendor/arbitrary-video", "image_to_video", "pinned-v1");
    const policy = resolveContentModelPolicy(contentFormatDefinition("slideshow"), [allowed, arbitrary])!;
    expect(contentModelAllowed(policy, allowed.qualification.status === "qualified" ? { provider: "replicate", model: allowed.model, version: allowed.qualification.version, inputSchemaDigest: allowed.qualification.inputSchemaDigest } : (null as never))).toBe(true);
    expect(contentModelAllowed(policy, arbitrary.qualification.status === "qualified" ? { provider: "replicate", model: arbitrary.model, version: arbitrary.qualification.version, inputSchemaDigest: arbitrary.qualification.inputSchemaDigest } : (null as never))).toBe(false);
  });
});
