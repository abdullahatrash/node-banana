import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { BrandProfileV1 } from "@/lib/onboarding/schemas";
import type { Composition, CreativeRequest, StructuredCopy } from "../contracts";

export const sha = `sha256:${"a".repeat(64)}`;
export const brand: BrandProfileV1 = {
  schemaVersion: 1, contentLanguage: "ar", identity: { companyName: "Tasmeem", coreIdentity: "محتوى قابل للتحرير", logoAssetId: null }, offering: ["أفكار محتوى"], audiences: [{ name: "الفرق", description: "فرق تسويق", weight: 100 }], problems: [], benefits: ["نصوص قابلة للتحرير"], differentiators: ["لغة عربية"], mission: "مساعدة الفرق", positioning: "تصميم هادئ ودافئ", ownedSpace: "أفكار المحتوى", businessModel: "b2b", categories: ["saas"], voice: { descriptors: ["واضح"], do: ["تحدث ببساطة"], doNot: ["لا تبالغ"] }, prohibitedClaims: ["نتائج مضمونة"], prohibitedTopics: ["معلومات خاصة"], competitors: [{ name: "UNRELATED_COMPETITOR", url: null }], contentAngles: ["UNRELATED_CONTENT_ANGLE"], uncertainties: ["UNRELATED_UNCERTAINTY"], evidence: [{ sourceId: "source-1", excerptHash: sha }], sourceIds: ["source-1"],
};
export function request(language: CreativeRequest["contentLanguage"] = "mixed"): CreativeRequest {
  return { schema: "creative-request/v1", workspaceId: "workspace-1", idempotencyKey: "creative-key-1", brand: { profileId: "brand-1", revision: 3, digest: canonicalDigest(brand) }, contentLanguage: language, arabicVariety: language === "en" ? null : "gulf", instructions: "منتج على طاولة في ضوء دافئ", output: { format: "image", aspectRatio: "9:16", width: 720, height: 1280, durationMs: null, fps: null }, sourceAssets: [], rights: { snapshotId: "rights-1", revision: 1, digest: sha, basis: "owned", permittedRemix: "transform", evidenceIds: [] }, fundingMode: "managed" };
}
export function copy(language: StructuredCopy["language"] = "mixed"): StructuredCopy {
  const blocks: StructuredCopy["blocks"] = [];
  if (language !== "en") blocks.push({ id: "ar-headline", language: "ar", role: "headline", readingOrder: 0, spans: [{ kind: "text", text: "  جرّب " }, { kind: "literal", text: "Tasmeem X-42 (@team)", direction: "ltr" }, { kind: "text", text: " الآن!  " }], timing: null });
  if (language !== "ar") blocks.push({ id: "en-headline", language: "en", role: "headline", readingOrder: 0, spans: [{ kind: "text", text: "Try Tasmeem X-42 today." }], timing: null });
  return { schema: "creative-copy/v1", revision: 1, language, arabicVariety: language === "en" ? null : "gulf", blocks, altText: { ar: language !== "en" ? "منتج على طاولة" : null, en: language !== "ar" ? "A product on a table" : null } };
}
export function composition(text = copy(), plateDigest = sha): Composition {
  return { schema: "arabic-safe-composition/v1", revision: 1, copyDigest: canonicalDigest(text), plate: { assetId: "plate-1", digest: plateDigest }, canvas: request().output, safeZone: "short-form-v1", background: "#000000", layers: text.blocks.map((block, index) => ({ blockId: block.id, box: { x: 60, y: 180 + index * 300, width: 530, height: 250 }, typography: { font: "noto-sans-arabic-v1", size: 40, minimumSize: 24, weight: "regular", lineHeight: 1.2, align: "start" }, foreground: "#ffffff", background: "#161616", padding: 16, overflow: "shrink" })) };
}
