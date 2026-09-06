import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { contentThemeDocumentSchema, type ContentThemeDocument } from "./content-execution-resources";

const licenseTerms = {
  schema: "tasmeemai-original-theme-license/v1",
  owner: "Tasmeemai",
  scope: "Commercial generation configuration for an entitled Workspace; no third-party source media is bundled.",
  restrictions: ["No trademark implication", "No copyrighted-character imitation", "No removal of source attribution or rights evidence"],
} as const;

export const CURATED_THEME_LICENSE_ID = `curated-theme-license:v1:${canonicalDigest(licenseTerms).slice(7)}`;
export const CURATED_THEME_LIMIT = 50;

const motifs = [
  { id: "editorial", en: "Editorial Focus", ar: "تركيز تحريري", prompt: "structured editorial framing, calm hierarchy, generous breathing room", note: { en: "Clear hierarchy for explainers and launches.", ar: "تسلسل بصري واضح للشروحات والإطلاقات." } },
  { id: "kinetic", en: "Kinetic Type", ar: "حروف حركية", prompt: "rhythmic typographic motion, bold short phrases, controlled transitions", note: { en: "Designed for legible Arabic and English motion type.", ar: "مصممة لحركة حروف عربية وإنجليزية مقروءة." } },
  { id: "product", en: "Product Clarity", ar: "وضوح المنتج", prompt: "clean product demonstration, tactile detail, credible studio lighting", note: { en: "Keeps product evidence central.", ar: "تبقي دليل المنتج في مركز المشهد." } },
  { id: "lifestyle", en: "Warm Lifestyle", ar: "أسلوب حياة دافئ", prompt: "natural everyday setting, warm human scale, region-neutral wardrobe and spaces", note: { en: "Human warmth without cultural stereotyping.", ar: "دفء إنساني من دون تنميط ثقافي." } },
  { id: "geometry", en: "Modern Geometry", ar: "هندسة معاصرة", prompt: "precise geometric layers, architectural rhythm, restrained depth", note: { en: "Contemporary structure inspired by regional geometry, not copied ornament.", ar: "بنية معاصرة تستلهم الهندسة الإقليمية من دون نسخ الزخارف." } },
  { id: "collage", en: "Layered Collage", ar: "كولاج متعدد الطبقات", prompt: "original cut-paper composition, layered depth, handcrafted transitions", note: { en: "Expressive composition with protected-expression safeguards.", ar: "تكوين تعبيري مع ضوابط لحماية التعبير الأصلي." } },
  { id: "commerce", en: "Bold Commerce", ar: "تجارة جريئة", prompt: "direct offer hierarchy, crisp comparison cards, confident product pacing", note: { en: "Commerce-forward without misleading urgency.", ar: "موجهة للتجارة من دون استعجال مضلل." } },
  { id: "luxury", en: "Quiet Premium", ar: "فخامة هادئة", prompt: "understated premium composition, fine material texture, deliberate slow pacing", note: { en: "Premium restraint without imitating luxury brands.", ar: "فخامة منضبطة من دون محاكاة علامات فاخرة." } },
  { id: "playful", en: "Playful Objects", ar: "عناصر مرحة", prompt: "playful object choreography, stop-motion energy, clean handmade forms", note: { en: "Friendly motion using original shapes and objects.", ar: "حركة ودودة بعناصر وأشكال أصلية." } },
  { id: "data", en: "Data Story", ar: "حكاية البيانات", prompt: "clear numeric storytelling, progressive evidence reveals, accessible chart motion", note: { en: "Explains evidence without overstating causality.", ar: "تشرح الأدلة من دون المبالغة في السببية." } },
] as const;

const palettes = [
  { id: "desert-dusk", en: "Desert Dusk", ar: "غسق الصحراء", colors: ["#4A2C2A", "#D88C6A", "#F4D6B8", "#FFF8EF"] },
  { id: "gulf-coast", en: "Gulf Coast", ar: "ساحل الخليج", colors: ["#073B4C", "#118AB2", "#8ED1DC", "#F7FCFD"] },
  { id: "date-palm", en: "Date Palm", ar: "نخيل التمر", colors: ["#293F2D", "#5E7D45", "#C69C5D", "#F5E8C8"] },
  { id: "pearl-night", en: "Pearl Night", ar: "ليل اللؤلؤ", colors: ["#171A2B", "#454B66", "#C9CEDA", "#FAFAFC"] },
  { id: "saffron-sky", en: "Saffron Sky", ar: "سماء الزعفران", colors: ["#6B2D1A", "#E07A2D", "#F2C14E", "#FFF4D6"] },
] as const;

export interface CuratedContentTheme {
  id: string;
  revision: 1;
  authoredName: { ar: string; en: string };
  authoredDescription: { ar: string; en: string };
  culturalNote: { ar: string; en: string };
  document: ContentThemeDocument;
  digest: `sha256:${string}`;
  licenseEvidenceIds: [string];
}

export const CURATED_CONTENT_THEMES: readonly CuratedContentTheme[] = Object.freeze(motifs.flatMap((motif, motifIndex) => palettes.map((palette, paletteIndex) => {
  const document = contentThemeDocumentSchema.parse({
    schema: "content-theme/v1",
    visual: { stylePrompt: `Original Tasmeemai theme: ${motif.prompt}; ${palette.en.toLowerCase()} palette; preserve product truth, readable Arabic shaping, and safe 9:16 composition.`, palette: palette.colors, avoid: ["third-party logos", "watermarks", "copyrighted characters", "brand imitation", "illegible Arabic", "cultural stereotypes"] },
    captions: { style: motif.id, fontFamilies: ["Noto Sans Arabic", "Inter"], position: (["bottom", "center", "top"] as const)[(motifIndex + paletteIndex) % 3], bidi: "native" },
  });
  return {
    id: `${motif.id}-${palette.id}`,
    revision: 1 as const,
    authoredName: { en: `${motif.en} · ${palette.en}`, ar: `${motif.ar} · ${palette.ar}` },
    authoredDescription: { en: `${motif.note.en} Uses the ${palette.en} palette.`, ar: `${motif.note.ar} تستخدم لوحة ${palette.ar}.` },
    culturalNote: motif.note,
    document,
    digest: canonicalDigest(document) as `sha256:${string}`,
    licenseEvidenceIds: [CURATED_THEME_LICENSE_ID] as [string],
  };
})));

export function curatedContentTheme(id: string) {
  return CURATED_CONTENT_THEMES.find((theme) => theme.id === id) ?? null;
}

export function isCuratedContentThemeLicenseEvidence(input: {
  themeId: string;
  revision: number;
  digest: string;
  evidenceId: string;
}) {
  const prefix = "curated-theme:";
  if (!input.themeId.startsWith(prefix) || input.evidenceId !== CURATED_THEME_LICENSE_ID) return false;
  const theme = curatedContentTheme(input.themeId.slice(prefix.length));
  return Boolean(theme && theme.revision === input.revision && theme.digest === input.digest);
}
