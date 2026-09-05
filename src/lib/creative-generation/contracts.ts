import { z } from "zod";

export const CREATIVE_POLICY_REVISION = "arabic-safe-creative/v1" as const;
export const COMPOSITION_REVISION = "arabic-safe-composition/v1" as const;
export const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const id = z.string().min(1).max(200);
export const languageSchema = z.enum(["ar", "en", "mixed"]);
export const varietySchema = z.enum(["msa", "gulf", "egyptian", "levantine", "maghrebi", "other"]);
export const assetRefSchema = z.object({ assetId: id, digest: digestSchema }).strict();

// User text is never normalized, trimmed, reordered, or stripped. Invisible
// direction overrides are rejected; callers express direction using spans.
export const exactTextSchema = z.string().min(1).max(4_000).refine(
  (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)
    && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value),
  "creative.errors.directionControls",
);

export const creativeRequestSchema = z.object({
  schema: z.literal("creative-request/v1"),
  workspaceId: id,
  idempotencyKey: z.string().min(8).max(200),
  brand: z.object({ profileId: id, revision: z.number().int().positive(), digest: digestSchema }).strict(),
  contentLanguage: languageSchema,
  arabicVariety: varietySchema.nullable(),
  instructions: exactTextSchema,
  output: z.object({
    format: z.enum(["image", "video"]),
    aspectRatio: z.enum(["9:16", "1:1", "4:5", "16:9"]),
    width: z.number().int().min(256).max(4096),
    height: z.number().int().min(256).max(4096),
    durationMs: z.number().int().min(1000).max(60_000).nullable(),
    fps: z.number().int().min(1).max(60).nullable(),
  }).strict(),
  sourceAssets: z.array(assetRefSchema).max(20),
  rights: z.object({ snapshotId: id, revision: z.number().int().positive(), digest: digestSchema, basis: z.enum(["owned", "licensed", "public_domain", "consented"]), evidenceIds: z.array(id).max(20) }).strict(),
  fundingMode: z.enum(["managed", "byok"]),
}).strict().superRefine((value, context) => {
  const issue = (path: string[], message: string) => context.addIssue({ code: "custom", path, message });
  if ((value.contentLanguage === "en") !== (value.arabicVariety === null)) issue(["arabicVariety"], "creative.errors.varietyRequired");
  const [width, height] = value.output.aspectRatio.split(":").map(Number);
  if (value.output.width * height !== value.output.height * width) issue(["output", "aspectRatio"], "creative.errors.aspectRatio");
  if (value.output.format === "image" && (value.output.durationMs !== null || value.output.fps !== null)) issue(["output"], "creative.errors.duration");
  if (value.output.format === "video" && (value.output.durationMs === null || value.output.fps === null || value.output.aspectRatio !== "9:16")) issue(["output"], "creative.errors.duration");
  if (new Set(value.sourceAssets.map((asset) => asset.assetId)).size !== value.sourceAssets.length) issue(["sourceAssets"], "creative.errors.sourceBinding");
});
export type CreativeRequest = z.infer<typeof creativeRequestSchema>;

export const copySpanSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: exactTextSchema }).strict(),
  z.object({ kind: z.literal("literal"), text: exactTextSchema, direction: z.enum(["rtl", "ltr"]) }).strict(),
]);
export const copyBlockSchema = z.object({
  id,
  language: z.enum(["ar", "en"]),
  role: z.enum(["headline", "body", "cta", "disclaimer", "caption"]),
  readingOrder: z.number().int().nonnegative().max(50),
  spans: z.array(copySpanSchema).min(1).max(80),
  timing: z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).strict().nullable(),
}).strict();
export const structuredCopySchema = z.object({
  schema: z.literal("creative-copy/v1"),
  revision: z.number().int().positive(),
  language: languageSchema,
  arabicVariety: varietySchema.nullable(),
  blocks: z.array(copyBlockSchema).min(1).max(50),
  altText: z.object({ ar: exactTextSchema.nullable(), en: exactTextSchema.nullable() }).strict(),
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if ((value.language === "en") !== (value.arabicVariety === null)) issue("creative.errors.varietyRequired");
  if (new Set(value.blocks.map((block) => block.id)).size !== value.blocks.length) issue("creative.errors.copyOrder");
  for (const language of ["ar", "en"] as const) {
    const blocks = value.blocks.filter((block) => block.language === language);
    const required = value.language === "mixed" || value.language === language;
    if (required !== Boolean(blocks.length) || required !== Boolean(value.altText[language])) issue("creative.errors.copyLanguage");
    const orders = blocks.map((block) => block.readingOrder).sort((a, b) => a - b);
    if (orders.some((order, index) => order !== index)) issue("creative.errors.copyOrder");
    for (const block of blocks) {
      if (block.timing && block.timing.endMs <= block.timing.startMs) issue("creative.errors.duration");
      // Every foreign-script run, URL, handle, SKU, and number in Arabic
      // paragraphs must have an explicit isolation boundary.
      if (block.language === "ar" && block.spans.some((span) => span.kind === "text" && /[\p{Script=Latin}\p{N}@]/u.test(span.text))) issue("creative.errors.literalIsolation");
      if (block.language === "en" && block.spans.some((span) => span.kind === "text" && /\p{Script=Arabic}/u.test(span.text))) issue("creative.errors.literalIsolation");
    }
  }
});
export type StructuredCopy = z.infer<typeof structuredCopySchema>;
export type CopyBlock = z.infer<typeof copyBlockSchema>;

const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const compositionSchema = z.object({
  schema: z.literal(COMPOSITION_REVISION),
  revision: z.number().int().positive(),
  copyDigest: digestSchema,
  plate: assetRefSchema,
  canvas: creativeRequestSchema.shape.output,
  safeZone: z.enum(["short-form-v1", "image-v1"]),
  background: color,
  layers: z.array(z.object({
    blockId: id,
    box: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
    typography: z.object({ font: z.literal("noto-sans-arabic-v1"), size: z.number().int().min(12).max(240), minimumSize: z.number().int().min(12).max(240), weight: z.enum(["regular", "bold"]), lineHeight: z.number().min(1).max(2.5), align: z.enum(["start", "center", "end"]) }).strict(),
    foreground: color,
    background: color,
    padding: z.number().int().min(0).max(100),
    overflow: z.enum(["reject", "shrink"]),
  }).strict()).min(1).max(50),
}).strict();
export type Composition = z.infer<typeof compositionSchema>;

export class CreativeError extends Error {
  constructor(readonly code: `creative.errors.${string}`) { super(code); }
}
