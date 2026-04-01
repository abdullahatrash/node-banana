import type { SavedPrompt } from "@/store/simpleStudioStore";

/**
 * Curated seed prompts for the public prompt library.
 * Organized by mode and category.
 */
export const PROMPT_TEMPLATES: SavedPrompt[] = [
  // ── Photo: Product ──────────────────────────────────────────────
  {
    id: "tpl_photo_product_1",
    mode: "photo",
    name: "Product on White Background",
    promptText: "Professional product photography on a clean white background with soft studio lighting, sharp focus, high resolution, commercial quality",
    formConfig: { aspectRatio: "1:1", batchCount: 4 },
    isPublic: true,
  },
  {
    id: "tpl_photo_product_2",
    mode: "photo",
    name: "Product Lifestyle Shot",
    promptText: "Lifestyle product photography in a modern minimalist setting, natural window light, warm tones, shallow depth of field, Instagram-ready",
    formConfig: { aspectRatio: "4:5", batchCount: 4 },
    isPublic: true,
  },
  {
    id: "tpl_photo_product_3",
    mode: "photo",
    name: "Product Flat Lay",
    promptText: "Top-down flat lay arrangement of products with complementary props, clean background, balanced composition, editorial style",
    formConfig: { aspectRatio: "1:1", batchCount: 4 },
    isPublic: true,
  },

  // ── Photo: Fashion ──────────────────────────────────────────────
  {
    id: "tpl_photo_fashion_1",
    mode: "photo",
    name: "Fashion Editorial",
    promptText: "High fashion editorial photography, dramatic studio lighting, model wearing elegant outfit, bold composition, magazine quality",
    formConfig: { aspectRatio: "4:5", batchCount: 4 },
    isPublic: true,
  },
  {
    id: "tpl_photo_fashion_2",
    mode: "photo",
    name: "Street Style Portrait",
    promptText: "Urban street style fashion photography, natural light, candid pose, bokeh city background, trendy outfit, authentic feel",
    formConfig: { aspectRatio: "9:16", batchCount: 4 },
    isPublic: true,
  },

  // ── Photo: Food ─────────────────────────────────────────────────
  {
    id: "tpl_photo_food_1",
    mode: "photo",
    name: "Food Photography",
    promptText: "Appetizing food photography with natural side lighting, steam rising, rustic wooden surface, garnished beautifully, restaurant quality",
    formConfig: { aspectRatio: "1:1", batchCount: 4 },
    isPublic: true,
  },
  {
    id: "tpl_photo_food_2",
    mode: "photo",
    name: "Arabic Coffee & Dates",
    promptText: "Traditional Arabic coffee dallah with dates on an ornate brass tray, warm ambient lighting, cultural authenticity, rich colors",
    formConfig: { aspectRatio: "1:1", batchCount: 4 },
    isPublic: true,
  },

  // ── Photo: Real Estate ──────────────────────────────────────────
  {
    id: "tpl_photo_realestate_1",
    mode: "photo",
    name: "Interior Design",
    promptText: "Modern luxury interior design, spacious living room with floor-to-ceiling windows, natural light, warm neutral palette, architectural photography",
    formConfig: { aspectRatio: "16:9", batchCount: 4 },
    isPublic: true,
  },

  // ── Photo: Social Media ─────────────────────────────────────────
  {
    id: "tpl_photo_social_1",
    mode: "photo",
    name: "Instagram Story Background",
    promptText: "Aesthetic gradient background for Instagram stories, soft pastel colors, minimal abstract shapes, text-friendly negative space",
    formConfig: { aspectRatio: "9:16", batchCount: 8 },
    isPublic: true,
  },
  {
    id: "tpl_photo_social_2",
    mode: "photo",
    name: "Social Media Quote Card",
    promptText: "Elegant background for a motivational quote, subtle texture, muted warm tones, centered empty space for text overlay, sophisticated feel",
    formConfig: { aspectRatio: "1:1", batchCount: 4 },
    isPublic: true,
  },

  // ── Video ───────────────────────────────────────────────────────
  {
    id: "tpl_video_product_1",
    mode: "video",
    name: "Product Reveal",
    promptText: "Smooth cinematic product reveal animation, object rotating slowly on a dark background with dramatic rim lighting, luxury feel",
    formConfig: { aspectRatio: "1:1", videoDuration: 5, batchCount: 2 },
    isPublic: true,
  },
  {
    id: "tpl_video_social_1",
    mode: "video",
    name: "Social Media Reel Intro",
    promptText: "Dynamic short intro animation with modern motion graphics, bold colors, energetic transitions, perfect for TikTok or Reels",
    formConfig: { aspectRatio: "9:16", videoDuration: 3, batchCount: 2 },
    isPublic: true,
  },
  {
    id: "tpl_video_nature_1",
    mode: "video",
    name: "Desert Landscape",
    promptText: "Aerial cinematic shot of vast golden sand dunes, sunrise light casting long shadows, gentle wind moving sand, Arabian desert atmosphere",
    formConfig: { aspectRatio: "16:9", videoDuration: 5, batchCount: 2 },
    isPublic: true,
  },

  // ── Copy: Social Media ──────────────────────────────────────────
  {
    id: "tpl_copy_social_1",
    mode: "copy",
    name: "Instagram Caption — Product Launch",
    promptText: "Write an engaging Instagram caption for a new product launch. Include a hook, benefits, call-to-action, and relevant hashtags. Keep it under 150 words.",
    formConfig: { tone: "casual", platform: "instagram", outputLanguage: "en", batchCount: 4 },
    isPublic: true,
  },
  {
    id: "tpl_copy_social_2",
    mode: "copy",
    name: "LinkedIn Post — Business Update",
    promptText: "Write a professional LinkedIn post announcing a company milestone or achievement. Include context, impact, and a forward-looking statement. 100-200 words.",
    formConfig: { tone: "professional", platform: "linkedin", outputLanguage: "en", batchCount: 4 },
    isPublic: true,
  },
  {
    id: "tpl_copy_social_3",
    mode: "copy",
    name: "X/Twitter Thread Hook",
    promptText: "Write a compelling first tweet for a thread about a business lesson or industry insight. Must be attention-grabbing, under 280 characters, and make people want to read more.",
    formConfig: { tone: "creative", platform: "x", outputLanguage: "en", batchCount: 8 },
    isPublic: true,
  },
  {
    id: "tpl_copy_arabic_1",
    mode: "copy",
    name: "منشور إنستغرام — إطلاق منتج",
    promptText: "اكتب وصف جذاب لمنشور إنستغرام عن إطلاق منتج جديد. يتضمن عبارة لافتة للانتباه، فوائد المنتج، ودعوة للتفاعل. أقل من 150 كلمة.",
    formConfig: { tone: "casual", platform: "instagram", outputLanguage: "ar", batchCount: 4 },
    isPublic: true,
  },
  {
    id: "tpl_copy_arabic_2",
    mode: "copy",
    name: "نص إعلاني — عرض خاص",
    promptText: "اكتب نص إعلاني مقنع لعرض خاص أو تخفيضات. يتضمن الإلحاح، القيمة، والدعوة للشراء. أسلوب تسويقي احترافي.",
    formConfig: { tone: "persuasive", platform: "general", outputLanguage: "ar", batchCount: 4 },
    isPublic: true,
  },

  // ── Copy: General ───────────────────────────────────────────────
  {
    id: "tpl_copy_general_1",
    mode: "copy",
    name: "Email Subject Lines",
    promptText: "Write compelling email subject lines for a promotional campaign. Each should be under 50 characters, create curiosity or urgency, and avoid spam trigger words.",
    formConfig: { tone: "creative", platform: "general", outputLanguage: "en", batchCount: 12 },
    isPublic: true,
  },
  {
    id: "tpl_copy_general_2",
    mode: "copy",
    name: "Product Description",
    promptText: "Write a compelling product description that highlights key features and benefits. Use sensory language and address customer pain points. 50-100 words.",
    formConfig: { tone: "persuasive", platform: "general", outputLanguage: "en", batchCount: 4 },
    isPublic: true,
  },
];
