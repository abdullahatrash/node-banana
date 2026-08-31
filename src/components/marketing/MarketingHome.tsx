import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BarChart3Icon,
  CalendarDaysIcon,
  CheckIcon,
  FilmIcon,
  FolderOpenIcon,
  Globe2Icon,
  ImageIcon,
  Layers3Icon,
  MessageSquareTextIcon,
  PlayIcon,
  SendIcon,
  SparklesIcon,
  TypeIcon,
  WandSparklesIcon,
} from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { Locale } from "@/store/directionStore";
import styles from "./marketing-home.module.css";

interface MarketingHomeProps {
  locale: Locale;
  contentStudioUrl: string;
  signInUrl: string;
  signUpUrl: string;
}

const arabicCopy = {
  nav: {
    product: "المنتج",
    how: "كيف يعمل",
    platforms: "المنصات",
    faq: "الأسئلة",
    signIn: "تسجيل الدخول",
    start: "ابدأ الآن",
  },
  hero: {
    badge: "جديد · تقويم محتوى قصير للمنطقة",
    titleBefore: "30 يومًا من المحتوى",
    titleAccent: "القصير، في دقائق",
    body: "اكتشف ما ينجح في سوقك، وحوّله إلى فيديوهات وشرائح تحمل هوية علامتك، ثم راجع وانشر عبر تيك توك وإنستغرام ريلز ويوتيوب شورتس.",
    primary: "أنشئ تقويمك مجانًا",
    secondary: "شاهد كيف يعمل",
    note: "وصول مبكر مجاني · حساباتك تبقى ملكك",
  },
  mockup: {
    eyebrow: "محرك المحتوى القصير",
    heading: "خطة محتوى 30 يومًا",
    prompt: "حوّل هذا المنتج إلى سلسلة فيديوهات قصيرة للجمهور السعودي...",
    generate: "أنشئ الخطة",
    calendar: "تقويم المحتوى",
    ready: "12 فكرة جاهزة",
    social: "فيديو قصير",
  },
  proof: [
    { label: "من الترند إلى المحتوى", detail: "لا تبدأ من صفحة فارغة" },
    { label: "30 يومًا أمامك", detail: "تقويم جاهز للمراجعة" },
    { label: "مصمم لـ MENA", detail: "أسواق ولهجات ومواسم المنطقة" },
    { label: "نشر مباشر", detail: "تيك توك وريلز وشورتس" },
  ],
  transformation: {
    eyebrow: "من الترند إلى علامتك",
    title: "حوّل ما يشاهده جمهورك إلى محتوى يناسب منتجك",
    body: "بدل البدء من الصفر كل يوم، يبدأ تصميمي من سوقك وجمهورك وما ينجح الآن، ثم يحوّل ذلك إلى خطة محتوى تحمل صوت علامتك.",
    cards: [
      {
        number: "01",
        title: "اختر سوقك ومجالك",
        body: "حدّد البلد والجمهور والموضوع الذي تريد أن تُعرف به.",
      },
      {
        number: "02",
        title: "حوّل الترند إلى محتوى",
        body: "أنشئ نسخًا أصلية مستوحاة مما ينجح، ومخصّصة لمنتجك.",
      },
      {
        number: "03",
        title: "املأ التقويم وانشر",
        body: "راجع الخطة، عدّل ما تريد، ثم جدول النشر عبر حساباتك.",
      },
    ],
  },
  showcase: {
    eyebrow: "محتوى قصير بكل الصيغ",
    title: "فكرة واحدة، عشرات القطع الجاهزة للنشر",
    body: "حوّل الفكرة نفسها إلى فيديو قصير أو منشور شرائح أو محتوى منتج أو فيديو بدون ظهور، مع الحفاظ على هوية علامتك.",
    items: [
      { title: "إعلان منتج", tag: "فيديو قصير" },
      { title: "شرح سريع", tag: "شرائح TikTok" },
      { title: "عرض موسمي", tag: "Instagram Reel" },
      { title: "محتوى بدون ظهور", tag: "YouTube Short" },
    ],
  },
  steps: {
    eyebrow: "كيف يعمل",
    title: "من رابط منتجك إلى تقويم ممتلئ",
    items: [
      { title: "أدخل موقعك أو منتجك", body: "نتعرّف على عرضك وجمهورك وصوت علامتك." },
      { title: "اختر السوق والجمهور", body: "حدّد البلد والنيتش والقنوات التي تريد نموها." },
      { title: "دع تصميمي يبني الخطة", body: "أنشئ أفكارًا وفيديوهات وشرائح موزعة على التقويم." },
      { title: "راجع وانشر", body: "عدّل المحتوى ثم جدوله عبر حساباتك المرتبطة." },
    ],
  },
  features: {
    eyebrow: "أدوات أقل. نشر أكثر.",
    title: "محرك محتوى قصير يعمل معك كل أسبوع",
    body: "كل جزء من تصميمي مبني لإبقاء تقويمك ممتلئًا بمحتوى يناسب علامتك وسوقك، من الفكرة وحتى النشر.",
    items: [
      { title: "اكتشاف الترندات", body: "اعثر على الزوايا والصيغ التي تتحرك في سوقك ومجالك.", icon: "copilot" },
      { title: "ملف ذكي لعلامتك", body: "يحفظ المنتج والجمهور والصوت ليبقى كل محتوى متناسقًا.", icon: "library" },
      { title: "فيديوهات قصيرة", body: "حوّل الفكرة أو المادة الخام إلى فيديو رأسي سريع.", icon: "video" },
      { title: "منشورات شرائح", body: "أنشئ قصصًا تعليمية أو ترويجية قابلة للتمرير.", icon: "image" },
      { title: "تقويم تلقائي", body: "وزّع المحتوى على الأيام والقنوات ضمن خطة واضحة.", icon: "calendar" },
      { title: "نشر مباشر", body: "جدول وانشر عبر الحسابات التي تملكها وتربطها.", icon: "publish" },
      { title: "ما الذي ينجح؟", body: "تابع الأداء وكرّر الزوايا والصيغ الأفضل لعلامتك.", icon: "analytics" },
      { title: "كتابة عربية طبيعية", body: "نصوص وتعليقات مبنية للعربية، لا مترجمة إليها لاحقًا.", icon: "copy" },
    ],
  },
  mena: {
    eyebrow: "صُمّم هنا، للمنطقة",
    title: "ما ينجح في الرياض ليس بالضرورة ما ينجح في القاهرة",
    body: "تصميمي يتعامل مع المنطقة كأسواق مختلفة لها لهجاتها ومواسمها وثقافتها، حتى يبدو المحتوى محليًا لا مترجمًا.",
    points: [
      "ترندات بحسب السوق والمجال",
      "نصوص عربية ولهجات تناسب جمهورك",
      "حملات مرتبطة بمواسم المنطقة",
    ],
    markets: "الخليج · بلاد الشام · شمال أفريقيا",
  },
  platforms: {
    eyebrow: "من تقويم واحد إلى كل قناة",
    title: "اكتب مرة، وانشر حيث يوجد جمهورك",
    body: "جهّز كل قطعة بالمقاس والصيغة المناسبة للقناة، ثم راجع وجدول كل شيء من تقويم واحد.",
    names: ["TikTok", "Instagram Reels", "YouTube Shorts"],
    footnote: "تربط حسابات علامتك الحالية، وتبقى ملكيتها وتحكمها لك دائمًا.",
  },
  early: {
    eyebrow: "محتوى الشهر القادم يبدأ الآن",
    title: "لا تبدأ من صفحة فارغة كل يوم",
    body: "أدخل منتجك، اختر سوقك، ودع تصميمي يبني أول تقويم للمحتوى القصير. الوصول المبكر مجاني.",
    primary: "أنشئ تقويمك مجانًا",
    secondary: "افتح التطبيق",
  },
  faq: {
    eyebrow: "الأسئلة الشائعة",
    title: "إجابات مباشرة قبل أن تبدأ",
    items: [
      {
        question: "ما هو تصميمي؟",
        answer: "تصميمي منصة لصناعة ونشر المحتوى القصير للمنطقة العربية. يحوّل الترندات وأفكار علامتك إلى فيديوهات وشرائح موزعة على تقويم وجاهزة للمراجعة والنشر.",
      },
      {
        question: "ما أنواع المحتوى التي يمكنني إنشاؤها؟",
        answer: "يركّز تصميمي على الفيديوهات القصيرة، ومنشورات الشرائح، ومحتوى المنتجات، والمحتوى بدون ظهور، والنصوص المصاحبة لها.",
      },
      {
        question: "هل يمكنه ملء تقويم المحتوى تلقائيًا؟",
        answer: "هذا هو جوهر المنتج: تنشئ خطة محتوى متكررة من منتجك وسوقك، ثم تراجع القطع وتعدّلها قبل جدولتها أو نشرها.",
      },
      {
        question: "هل المنتج متاح خارج منطقة MENA؟",
        answer: "تركيز المنتج الحالي حصري على منطقة الشرق الأوسط وشمال أفريقيا، حتى نبني تجربة أعمق لاحتياجات فرق المحتوى المحلية.",
      },
      {
        question: "هل أستطيع النشر مباشرة إلى حساباتي؟",
        answer: "نعم. يركّز مسار النشر على تيك توك وإنستغرام ريلز ويوتيوب شورتس، وفق الصلاحيات وسياسات كل منصة.",
      },
      {
        question: "هل تبيعون حسابات TikTok أو Instagram؟",
        answer: "لا. تصميمي لا يبيع الحسابات أو يدير هويات مزيفة. أنت تربط حسابات علامتك التي تملكها وتتحكم بها.",
      },
      {
        question: "هل يمكن استخدام الواجهة بالإنجليزية؟",
        answer: "نعم. العربية هي اللغة الافتراضية، ويمكنك التحويل إلى الإنجليزية من زر اللغة في أي وقت.",
      },
      {
        question: "هل هناك خطة مجانية؟",
        answer: "البدء مجاني حاليًا خلال مرحلة الوصول المبكر. سنعرض أي تغييرات مستقبلية في الخطط بوضوح قبل تطبيقها.",
      },
    ],
  },
  footer: {
    description: "منصة صناعة ونشر المحتوى القصير للمنطقة العربية.",
    product: "المنتج",
    company: "تصميمي",
    links: ["الميزات", "كيف يعمل", "المنصات", "الأسئلة الشائعة"],
    start: "ابدأ مجانًا",
    rights: "جميع الحقوق محفوظة.",
    region: "صُمّم للشرق الأوسط وشمال أفريقيا",
  },
};

const englishCopy = {
  nav: {
    product: "Product",
    how: "How it works",
    platforms: "Platforms",
    faq: "FAQ",
    signIn: "Sign in",
    start: "Get started",
  },
  hero: {
    badge: "New · A short-form calendar built for MENA",
    titleBefore: "30 days of short-form",
    titleAccent: "content, in minutes",
    body: "Discover what works in your market, turn it into branded videos and slides, then review and publish across TikTok, Instagram Reels, and YouTube Shorts.",
    primary: "Build my calendar free",
    secondary: "See how it works",
    note: "Free early access · Your accounts stay yours",
  },
  mockup: {
    eyebrow: "Short-form engine",
    heading: "30-day content plan",
    prompt: "Turn this product into a series of short videos for Saudi audiences...",
    generate: "Build the plan",
    calendar: "Content calendar",
    ready: "12 ideas ready",
    social: "Short-form video",
  },
  proof: [
    { label: "Trend to content", detail: "Never start from a blank page" },
    { label: "30 days ahead", detail: "A calendar ready to review" },
    { label: "Made for MENA", detail: "Regional markets, dialects, seasons" },
    { label: "Publish directly", detail: "TikTok, Reels, and Shorts" },
  ],
  transformation: {
    eyebrow: "From the trend to your brand",
    title: "Turn what your audience watches into content for your product",
    body: "Instead of starting from scratch every day, Tasmeemai begins with your market, audience, and what is working now, then builds a content plan in your brand voice.",
    cards: [
      { number: "01", title: "Choose your market and niche", body: "Set the country, audience, and topic you want to own." },
      { number: "02", title: "Turn trends into content", body: "Create original, brand-specific takes on formats that work." },
      { number: "03", title: "Fill the calendar and publish", body: "Review the plan, edit what you want, then schedule it." },
    ],
  },
  showcase: {
    eyebrow: "Every short-form format",
    title: "One idea, dozens of publish-ready pieces",
    body: "Turn the same idea into a short video, slideshow, product post, or faceless clip without losing your brand identity.",
    items: [
      { title: "Product promotion", tag: "Short video" },
      { title: "Quick explainer", tag: "TikTok slideshow" },
      { title: "Seasonal offer", tag: "Instagram Reel" },
      { title: "Faceless content", tag: "YouTube Short" },
    ],
  },
  steps: {
    eyebrow: "How it works",
    title: "From your product link to a full calendar",
    items: [
      { title: "Add your site or product", body: "We learn your offer, audience, and brand voice." },
      { title: "Choose the market", body: "Set the country, niche, and channels you want to grow." },
      { title: "Let Tasmeemai build the plan", body: "Generate ideas, videos, and slides across the calendar." },
      { title: "Review and publish", body: "Edit the content, then schedule it through connected accounts." },
    ],
  },
  features: {
    eyebrow: "Fewer tools. More publishing.",
    title: "A short-form engine that works with you every week",
    body: "Every part of Tasmeemai keeps your calendar filled with content for your brand and market, from the first angle to the published post.",
    items: [
      { title: "Trend discovery", body: "Find the angles and formats moving in your market and niche.", icon: "copilot" },
      { title: "Smart brand profile", body: "Keep the product, audience, and voice consistent in every piece.", icon: "library" },
      { title: "Short videos", body: "Turn an idea or source asset into a fast vertical video.", icon: "video" },
      { title: "Slideshow posts", body: "Create educational and promotional stories people can swipe.", icon: "image" },
      { title: "Automatic calendar", body: "Distribute content across days and channels in one clear plan.", icon: "calendar" },
      { title: "Direct publishing", body: "Schedule through the social accounts you own and connect.", icon: "publish" },
      { title: "See what works", body: "Track performance and repeat your strongest angles and formats.", icon: "analytics" },
      { title: "Natural Arabic copy", body: "Captions and scripts built for Arabic, not translated into it.", icon: "copy" },
    ],
  },
  mena: {
    eyebrow: "Built here, for the region",
    title: "What works in Riyadh may not work in Cairo",
    body: "Tasmeemai treats MENA as distinct markets with their own dialects, seasons, and culture, so content feels local rather than translated.",
    points: ["Trends by market and niche", "Arabic copy and dialects for your audience", "Campaigns built around regional moments"],
    markets: "Gulf · Levant · North Africa",
  },
  platforms: {
    eyebrow: "One calendar, every channel",
    title: "Create once, publish where your audience watches",
    body: "Prepare every piece for the right format and channel, then review and schedule everything from one calendar.",
    names: ["TikTok", "Instagram Reels", "YouTube Shorts"],
    footnote: "You connect your existing brand accounts and always keep ownership and control.",
  },
  early: {
    eyebrow: "Next month's content starts now",
    title: "Stop starting from a blank page every day",
    body: "Add your product, choose the market, and let Tasmeemai build your first short-form content calendar. Early access is free.",
    primary: "Build my calendar free",
    secondary: "Open the app",
  },
  faq: {
    eyebrow: "Frequently asked questions",
    title: "Straight answers before you begin",
    items: [
      { question: "What is Tasmeemai?", answer: "Tasmeemai is a short-form content creation and publishing platform for MENA. It turns trends and brand ideas into videos and slides placed on a calendar for review and publishing." },
      { question: "What content can I create?", answer: "Tasmeemai focuses on short videos, slideshow posts, product content, faceless content, and the scripts and captions that go with them." },
      { question: "Can it fill my content calendar automatically?", answer: "That is the core of the product: build a recurring content plan from your product and market, then review and edit each piece before scheduling or publishing." },
      { question: "Is the product available outside MENA?", answer: "The product is currently focused exclusively on the Middle East and North Africa so we can build a deeper experience for regional content teams." },
      { question: "Can I publish directly to my accounts?", answer: "Yes. The publishing workflow focuses on TikTok, Instagram Reels, and YouTube Shorts, subject to each platform's policies and permissions." },
      { question: "Do you sell TikTok or Instagram accounts?", answer: "No. Tasmeemai does not sell accounts or operate fake identities. You connect the brand accounts that you own and control." },
      { question: "Can I use the interface in English?", answer: "Yes. Arabic is the default, and you can switch to English from the language control at any time." },
      { question: "Is there a free plan?", answer: "It is currently free to start during early access. Any future plan changes will be communicated clearly before they take effect." },
    ],
  },
  footer: {
    description: "Short-form content creation and publishing for MENA.",
    product: "Product",
    company: "Tasmeemai",
    links: ["Features", "How it works", "Platforms", "FAQ"],
    start: "Start free",
    rights: "All rights reserved.",
    region: "Built for the Middle East and North Africa",
  },
};

const showcaseImages = [
  "/sample-images/new-bg-model-product.png",
  "/sample-images/desert.jpg",
  "/sample-images/cosmetics.jpg",
  "/sample-images/model-3.jpg",
];

const featureIcons = {
  image: ImageIcon,
  video: FilmIcon,
  copy: TypeIcon,
  calendar: CalendarDaysIcon,
  publish: SendIcon,
  library: FolderOpenIcon,
  analytics: BarChart3Icon,
  copilot: MessageSquareTextIcon,
};

export function MarketingHome({
  locale,
  contentStudioUrl,
  signInUrl,
  signUpUrl,
}: MarketingHomeProps) {
  const copy = locale === "ar" ? arabicCopy : englishCopy;
  const isArabic = locale === "ar";
  const ArrowIcon = isArabic ? ArrowLeftIcon : ArrowRightIcon;

  return (
    <div className={`${styles.page} min-h-screen overflow-hidden bg-[#fbf7ef] text-[#102d2a]`}>
      <header className="sticky top-0 z-50 border-b border-[#143f38]/10 bg-[#fbf7ef]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
          <Link href="/" className="group flex items-center gap-2.5" aria-label={isArabic ? "الصفحة الرئيسية لتصميمي" : "Tasmeemai home"}>
            <span className="flex size-9 items-center justify-center rounded-[13px] bg-[#0d4f45] text-lg font-bold text-[#fffaf0] shadow-[0_6px_18px_rgba(13,79,69,0.2)] transition-transform group-hover:-rotate-3">
              ت
            </span>
            <span className="text-xl font-bold tracking-[-0.03em]">{isArabic ? "تصميمي" : "Tasmeemai"}</span>
          </Link>

          <nav className="hidden items-center gap-7 text-sm font-medium text-[#294b46] md:flex" aria-label={isArabic ? "التنقل الرئيسي" : "Main navigation"}>
            <a className="transition-colors hover:text-[#e75f45]" href="#product">{copy.nav.product}</a>
            <a className="transition-colors hover:text-[#e75f45]" href="#how">{copy.nav.how}</a>
            <a className="transition-colors hover:text-[#e75f45]" href="#platforms">{copy.nav.platforms}</a>
            <a className="transition-colors hover:text-[#e75f45]" href="#faq">{copy.nav.faq}</a>
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-3">
            <LanguageSwitcher className="rounded-full px-2.5 text-[#294b46] hover:bg-[#e9e1d4] hover:text-[#102d2a] sm:px-3" />
            <Link className="hidden text-sm font-medium text-[#294b46] transition-colors hover:text-[#e75f45] sm:block" href={signInUrl}>
              {copy.nav.signIn}
            </Link>
            <Link className="rounded-full bg-[#0d4f45] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(13,79,69,0.18)] transition hover:-translate-y-0.5 hover:bg-[#0a4038]" href={signUpUrl}>
              {copy.nav.start}
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative px-5 pb-20 pt-14 sm:px-8 sm:pt-20 lg:px-10 lg:pb-28 lg:pt-24">
          <div className={styles.heroGlow} aria-hidden="true" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
            <div className="relative z-10 max-w-2xl">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#0d4f45]/14 bg-white/70 px-3.5 py-2 text-xs font-semibold text-[#0d4f45] shadow-sm">
                <SparklesIcon className="size-3.5 text-[#e75f45]" aria-hidden="true" />
                {copy.hero.badge}
              </div>
              <h1 className={`${styles.heroHeading} text-balance text-[clamp(3.2rem,6.2vw,5.8rem)] font-bold leading-[0.98] tracking-[-0.065em] text-[#102d2a]`}>
                {copy.hero.titleBefore}
                <span className="mt-2 block text-[#e75f45]">{copy.hero.titleAccent}</span>
              </h1>
              <p className="mt-7 max-w-xl text-pretty text-lg leading-8 text-[#47635e] sm:text-xl sm:leading-9">
                {copy.hero.body}
              </p>
              <div className="mt-9 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <Link className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#0d4f45] px-6 text-sm font-bold text-white shadow-[0_14px_32px_rgba(13,79,69,0.22)] transition hover:-translate-y-0.5 hover:bg-[#0a4038]" href={signUpUrl}>
                  {copy.hero.primary}
                  <ArrowIcon className="size-4 transition-transform group-hover:-translate-x-0.5 rtl:group-hover:-translate-x-0.5 ltr:group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
                <a className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[#0d4f45]/18 bg-white/50 px-6 text-sm font-bold text-[#0d4f45] transition hover:bg-white" href="#how">
                  <PlayIcon className="size-4 fill-current" aria-hidden="true" />
                  {copy.hero.secondary}
                </a>
              </div>
              <p className="mt-4 flex items-center gap-2 text-xs text-[#647a75]">
                <CheckIcon className="size-3.5 rounded-full bg-[#cde6d8] p-0.5 text-[#0d4f45]" aria-hidden="true" />
                {copy.hero.note}
              </p>
            </div>

            <HeroWorkspaceMockup copy={copy.mockup} />
          </div>
        </section>

        <section className="border-y border-[#143f38]/10 bg-white/45 px-5 sm:px-8 lg:px-10" aria-label={isArabic ? "مزايا التوجه الإقليمي" : "Regional positioning"}>
          <div className="mx-auto grid max-w-7xl divide-y divide-[#143f38]/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4 rtl:sm:divide-x-reverse">
            {copy.proof.map((item) => (
              <div className="px-5 py-7 first:ps-0 last:pe-0 lg:px-7" key={item.label}>
                <p className="font-bold text-[#153d37]">{item.label}</p>
                <p className="mt-1 text-sm text-[#647a75]">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="product" className="scroll-mt-24 px-5 py-24 sm:px-8 lg:px-10 lg:py-32">
          <div className="mx-auto max-w-7xl">
            <SectionHeading eyebrow={copy.transformation.eyebrow} title={copy.transformation.title} body={copy.transformation.body} />
            <div className="mt-14 grid gap-4 md:grid-cols-3">
              {copy.transformation.cards.map((card, index) => (
                <article className={`${styles.processCard} rounded-[28px] border border-[#143f38]/10 bg-white/65 p-7 shadow-[0_18px_50px_rgba(26,61,54,0.06)]`} key={card.number}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold tracking-[0.18em] text-[#e75f45]">{card.number}</span>
                    {index < 2 ? <ArrowIcon className="size-4 text-[#9bb0aa]" aria-hidden="true" /> : <CheckIcon className="size-4 text-[#0d4f45]" aria-hidden="true" />}
                  </div>
                  <h3 className="mt-10 text-2xl font-bold tracking-[-0.03em]">{card.title}</h3>
                  <p className="mt-3 leading-7 text-[#5d736e]">{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#102d2a] px-5 py-24 text-[#fffaf0] sm:px-8 lg:px-10 lg:py-32">
          <div className="mx-auto max-w-7xl">
            <SectionHeading dark eyebrow={copy.showcase.eyebrow} title={copy.showcase.title} body={copy.showcase.body} />
            <div className="mt-14 grid auto-rows-[230px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {copy.showcase.items.map((item, index) => (
                <article className={`${styles.showcaseCard} ${index === 1 ? "sm:col-span-2 lg:col-span-2" : ""} ${index === 3 ? "lg:row-span-2" : ""} group relative overflow-hidden rounded-[26px]`} key={item.title}>
                  <Image src={showcaseImages[index]} alt={item.title} fill sizes={index === 1 ? "(max-width: 640px) 100vw, 50vw" : "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"} className="object-cover transition duration-700 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#102d2a]/85 via-transparent to-transparent" />
                  {index === 1 ? <span className="absolute end-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/90 text-[#102d2a] shadow-lg"><PlayIcon className="size-4 fill-current" aria-hidden="true" /></span> : null}
                  <div className="absolute inset-x-0 bottom-0 p-5">
                    <span className="text-[11px] font-semibold text-[#f4b8a8]">{item.tag}</span>
                    <h3 className="mt-1 text-xl font-bold text-white">{item.title}</h3>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-24 px-5 py-24 sm:px-8 lg:px-10 lg:py-32">
          <div className="mx-auto max-w-7xl">
            <SectionHeading centered eyebrow={copy.steps.eyebrow} title={copy.steps.title} />
            <div className="relative mt-16">
              <div className="absolute inset-x-[10%] top-6 hidden h-px bg-[#0d4f45]/15 md:block" aria-hidden="true" />
              <ol className="relative grid gap-8 md:grid-cols-4">
                {copy.steps.items.map((item, index) => (
                  <li className="relative text-center" key={item.title}>
                    <span className="relative z-10 mx-auto flex size-12 items-center justify-center rounded-2xl border border-[#0d4f45]/12 bg-[#fbf7ef] text-sm font-bold text-[#e75f45] shadow-[0_6px_20px_rgba(16,45,42,0.08)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="mt-6 text-lg font-bold">{item.title}</h3>
                    <p className="mx-auto mt-2 max-w-[15rem] text-sm leading-6 text-[#647a75]">{item.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="features" className="scroll-mt-24 px-5 pb-24 sm:px-8 lg:px-10 lg:pb-32">
          <div className="mx-auto max-w-7xl rounded-[36px] bg-[#eee6da] p-6 sm:p-10 lg:p-14">
            <SectionHeading eyebrow={copy.features.eyebrow} title={copy.features.title} body={copy.features.body} />
            <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {copy.features.items.map((feature) => {
                const Icon = featureIcons[feature.icon as keyof typeof featureIcons];
                return (
                  <article className="rounded-[24px] border border-white/60 bg-[#fbf7ef]/80 p-6 transition duration-300 hover:-translate-y-1 hover:bg-white hover:shadow-[0_16px_40px_rgba(16,45,42,0.08)]" key={feature.title}>
                    <span className="flex size-10 items-center justify-center rounded-xl bg-[#cfe5d8] text-[#0d4f45]">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <h3 className="mt-7 text-lg font-bold">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-[#647a75]">{feature.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="px-5 pb-24 sm:px-8 lg:px-10 lg:pb-32">
          <div className="mx-auto grid max-w-7xl overflow-hidden rounded-[36px] bg-[#e46549] text-[#fffaf0] lg:grid-cols-[1.05fr_0.95fr]">
            <div className="p-8 sm:p-12 lg:p-16">
              <p className="text-xs font-bold tracking-[0.14em] text-[#ffd9ce]">{copy.mena.eyebrow}</p>
              <h2 className={`${styles.displayHeading} mt-5 max-w-2xl text-balance text-4xl font-bold leading-[1.12] tracking-[-0.045em] sm:text-5xl`}>{copy.mena.title}</h2>
              <p className="mt-6 max-w-xl text-lg leading-8 text-[#fff4ec]/85">{copy.mena.body}</p>
              <ul className="mt-8 space-y-3">
                {copy.mena.points.map((point) => (
                  <li className="flex items-center gap-3 text-sm font-semibold" key={point}>
                    <span className="flex size-6 items-center justify-center rounded-full bg-[#fffaf0] text-[#c54932]"><CheckIcon className="size-3.5" aria-hidden="true" /></span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <div className={`${styles.menaVisual} relative min-h-[420px] overflow-hidden p-8 sm:p-12 lg:min-h-full`}>
              <Globe2Icon className="absolute -bottom-14 -end-14 size-72 text-white/10" strokeWidth={0.7} aria-hidden="true" />
              <div className="relative flex h-full flex-col justify-between rounded-[28px] border border-white/20 bg-[#102d2a]/92 p-7 shadow-2xl">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/80">MENA</span>
                  <SparklesIcon className="size-5 text-[#f2ad8f]" aria-hidden="true" />
                </div>
                <p className={`${styles.displayHeading} max-w-xs text-4xl font-bold leading-tight tracking-[-0.04em] sm:text-5xl`}>{isArabic ? "نبدأ من هنا." : "We start here."}</p>
                <p className="text-sm font-medium text-white/65">{copy.mena.markets}</p>
              </div>
            </div>
          </div>
        </section>

        <section id="platforms" className="scroll-mt-24 border-y border-[#143f38]/10 bg-white/45 px-5 py-24 sm:px-8 lg:px-10 lg:py-28">
          <div className="mx-auto max-w-7xl text-center">
            <SectionHeading centered eyebrow={copy.platforms.eyebrow} title={copy.platforms.title} body={copy.platforms.body} />
            <div className="mx-auto mt-12 flex max-w-4xl flex-wrap justify-center gap-3" dir="ltr">
              {copy.platforms.names.map((name) => (
                <span className="flex items-center gap-2.5 rounded-2xl border border-[#143f38]/10 bg-[#fbf7ef] px-5 py-3.5 text-sm font-bold text-[#153d37] shadow-[0_8px_24px_rgba(16,45,42,0.05)]" key={name}>
                  <span className="size-2 rounded-full bg-[#e75f45]" />
                  {name}
                </span>
              ))}
            </div>
            <p className="mt-7 text-xs text-[#71847f]">{copy.platforms.footnote}</p>
          </div>
        </section>

        <section className="px-5 py-24 sm:px-8 lg:px-10 lg:py-32">
          <div className={`${styles.ctaPanel} relative mx-auto max-w-7xl overflow-hidden rounded-[38px] bg-[#0d4f45] px-6 py-16 text-center text-white sm:px-12 sm:py-20`}>
            <div className="relative z-10 mx-auto max-w-3xl">
              <p className="text-xs font-bold tracking-[0.14em] text-[#a9d7c3]">{copy.early.eyebrow}</p>
              <h2 className={`${styles.displayHeading} mt-5 text-balance text-4xl font-bold leading-tight tracking-[-0.045em] sm:text-6xl`}>{copy.early.title}</h2>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-white/70">{copy.early.body}</p>
              <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
                <Link className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#fffaf0] px-6 text-sm font-bold text-[#0d4f45] transition hover:-translate-y-0.5 hover:bg-white" href={signUpUrl}>
                  {copy.early.primary}<ArrowIcon className="size-4" aria-hidden="true" />
                </Link>
                <Link className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 bg-white/5 px-6 text-sm font-bold text-white transition hover:bg-white/10" href={contentStudioUrl}>
                  {copy.early.secondary}
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-24 px-5 pb-24 sm:px-8 lg:px-10 lg:pb-32">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
            <SectionHeading eyebrow={copy.faq.eyebrow} title={copy.faq.title} />
            <div className="divide-y divide-[#143f38]/12 border-y border-[#143f38]/12">
              {copy.faq.items.map((item, index) => (
                <details className="group py-1" key={item.question} open={index === 0}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-lg font-bold marker:content-none">
                    <span>{item.question}</span>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e8e1d6] transition group-open:rotate-45"><span className="text-xl font-light leading-none">+</span></span>
                  </summary>
                  <p className="max-w-2xl pb-6 text-sm leading-7 text-[#607570]">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#102d2a] px-5 py-12 text-white sm:px-8 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-10 border-b border-white/10 pb-12 md:grid-cols-[1.4fr_0.8fr_0.8fr]">
            <div>
              <Link href="/" className="inline-flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-[13px] bg-[#f0a487] text-lg font-bold text-[#102d2a]">ت</span>
                <span className="text-xl font-bold">{isArabic ? "تصميمي" : "Tasmeemai"}</span>
              </Link>
              <p className="mt-5 max-w-sm text-sm leading-7 text-white/55">{copy.footer.description}</p>
            </div>
            <nav aria-label={copy.footer.product}>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/55">{copy.footer.product}</p>
              <ul className="mt-5 space-y-3 text-sm text-white/75">
                <li><a className="hover:text-white" href="#features">{copy.footer.links[0]}</a></li>
                <li><a className="hover:text-white" href="#how">{copy.footer.links[1]}</a></li>
                <li><a className="hover:text-white" href="#platforms">{copy.footer.links[2]}</a></li>
                <li><a className="hover:text-white" href="#faq">{copy.footer.links[3]}</a></li>
              </ul>
            </nav>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/55">{copy.footer.company}</p>
              <Link className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#f5b89f] hover:text-white" href={signUpUrl}>{copy.footer.start}<ArrowIcon className="size-4" aria-hidden="true" /></Link>
              <p className="mt-5 text-xs leading-6 text-white/60">{copy.footer.region}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 pt-7 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} {isArabic ? "تصميمي" : "Tasmeemai"}. {copy.footer.rights}</p>
            <p dir="ltr">MENA · Arabic-first · RTL</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
  centered = false,
  dark = false,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  centered?: boolean;
  dark?: boolean;
}) {
  return (
    <div className={`${centered ? "mx-auto text-center" : ""} max-w-3xl`}>
      <p className={`text-xs font-bold tracking-[0.14em] ${dark ? "text-[#f2ad8f]" : "text-[#e75f45]"}`}>{eyebrow}</p>
      <h2 className={`${styles.displayHeading} mt-5 text-balance text-4xl font-bold leading-[1.12] tracking-[-0.045em] sm:text-5xl ${dark ? "text-white" : "text-[#102d2a]"}`}>{title}</h2>
      {body ? <p className={`mt-6 text-lg leading-8 ${dark ? "text-white/60" : "text-[#607570]"}`}>{body}</p> : null}
    </div>
  );
}

function HeroWorkspaceMockup({ copy }: { copy: typeof arabicCopy.mockup }) {
  return (
    <div className={`${styles.mockupWrap} relative mx-auto w-full max-w-[690px]`}>
      <div className="absolute -start-5 top-16 z-20 hidden w-44 rotate-[-4deg] rounded-2xl border border-[#143f38]/10 bg-[#fffaf0] p-4 shadow-[0_18px_45px_rgba(16,45,42,0.16)] sm:block rtl:rotate-[4deg]">
        <div className="flex items-center gap-2 text-xs font-bold text-[#102d2a]"><CalendarDaysIcon className="size-4 text-[#e75f45]" aria-hidden="true" />{copy.calendar}</div>
        <div className="mt-3 grid grid-cols-5 gap-1">
          {Array.from({ length: 15 }).map((_, index) => <span className={`aspect-square rounded-[4px] ${[3, 7, 11].includes(index) ? "bg-[#e75f45]" : "bg-[#e8e1d6]"}`} key={index} />)}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-[30px] border border-[#153d37]/14 bg-[#f7f3eb] p-2 shadow-[0_34px_90px_rgba(16,45,42,0.18)] sm:p-3">
        <div className="overflow-hidden rounded-[23px] border border-[#153d37]/10 bg-[#fffdf8]">
          <div className="flex h-11 items-center justify-between border-b border-[#153d37]/8 px-4">
            <div className="flex gap-1.5" dir="ltr"><span className="size-2.5 rounded-full bg-[#e98c78]" /><span className="size-2.5 rounded-full bg-[#e8c273]" /><span className="size-2.5 rounded-full bg-[#83b69d]" /></div>
            <span className="text-[10px] font-semibold text-[#78908a]">Tasmeemai Workspace</span>
          </div>
          <div className="grid min-h-[430px] grid-cols-[62px_1fr] sm:grid-cols-[150px_1fr]" dir="ltr">
            <aside className="border-r border-[#153d37]/8 bg-[#f2ede4] p-3">
              <div className="mb-7 flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-lg bg-[#0d4f45] text-xs font-bold text-white">ت</span><span className="hidden text-xs font-bold text-[#153d37] sm:block">Tasmeemai</span></div>
              <div className="space-y-2">
                {[WandSparklesIcon, Layers3Icon, CalendarDaysIcon, BarChart3Icon].map((Icon, index) => (
                  <div className={`flex items-center gap-2 rounded-lg px-2 py-2 ${index === 0 ? "bg-white text-[#0d4f45] shadow-sm" : "text-[#8a9b97]"}`} key={index}><Icon className="size-3.5" aria-hidden="true" /><span className="hidden h-1.5 w-14 rounded-full bg-current opacity-30 sm:block" /></div>
                ))}
              </div>
            </aside>
            <div className="min-w-0 p-4 sm:p-6" dir="rtl">
              <p className="text-[10px] font-semibold text-[#e75f45]">{copy.eyebrow}</p>
              <div className="mt-1 flex items-center justify-between gap-3">
                <h2 className="truncate text-base font-bold text-[#102d2a] sm:text-xl">{copy.heading}</h2>
                <span className="shrink-0 rounded-full bg-[#d8eadf] px-2 py-1 text-[8px] font-bold text-[#0d4f45]">{copy.ready}</span>
              </div>
              <div className="mt-5 rounded-2xl border border-[#153d37]/10 bg-[#f7f3eb] p-3">
                <p className="truncate text-[10px] text-[#6e817d]">{copy.prompt}</p>
                <div className="mt-3 flex justify-end"><span className="rounded-lg bg-[#0d4f45] px-3 py-1.5 text-[9px] font-bold text-white">{copy.generate}</span></div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-[#d9c4a7]"><Image src="/sample-images/cosmetics.jpg" alt="" fill priority sizes="(max-width: 768px) 35vw, 220px" className="object-cover" /></div>
                <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-[#d9c4a7]"><Image src="/sample-images/new-bg-model-product.png" alt="" fill priority sizes="(max-width: 768px) 35vw, 220px" className="object-cover" /></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-6 -end-3 z-20 w-48 rotate-[3deg] rounded-2xl border border-[#143f38]/10 bg-[#fffaf0] p-3.5 shadow-[0_18px_45px_rgba(16,45,42,0.16)] sm:-end-7 sm:w-56 rtl:rotate-[-3deg]">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f8d7cb] text-[#d55239]"><SendIcon className="size-4" aria-hidden="true" /></span>
          <div className="min-w-0"><p className="truncate text-xs font-bold text-[#102d2a]">{copy.social}</p><p className="mt-1 text-[9px] text-[#71847f]">Instagram · 18:30</p></div>
          <CheckIcon className="ms-auto size-4 shrink-0 text-[#0d4f45]" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
