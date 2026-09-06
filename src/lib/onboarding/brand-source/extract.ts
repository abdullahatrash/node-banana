import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

const PROMPT_INJECTION_PATTERNS = [
  /ignore (?:all |any )?(?:previous|prior|system) instructions?/i,
  /reveal (?:the )?(?:system prompt|developer message)/i,
  /act as (?:the )?system/i,
  /تجاهل (?:كل )?التعليمات/i,
  /اكشف (?:رسالة|تعليمات) النظام/i,
];

const HIGH_SIGNAL_PATH = /\/(?:about|company|product|products|service|services|pricing|features)(?:\/|$)/i;

export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function detectLanguage(text: string, declared?: string | null): string | null {
  const normalizedDeclared = declared?.trim().split(/[-_]/)[0]?.toLowerCase();
  if (normalizedDeclared && /^[a-z]{2,3}$/.test(normalizedDeclared)) {
    return normalizedDeclared;
  }
  const letters = text.match(/[\p{L}]/gu) ?? [];
  if (letters.length === 0) return null;
  const arabic = text.match(/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/g) ?? [];
  return arabic.length / letters.length >= 0.25 ? "ar" : "en";
}

function cleanLines(value: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const rawLine of value.split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line.length < 2 || PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(line))) {
      continue;
    }
    const key = line.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines.join("\n");
}

export interface ExtractedHtml {
  text: string;
  language: string | null;
  links: string[];
  noFollow: boolean;
}

export function extractHtml(html: string, pageUrl: URL): ExtractedHtml {
  const $ = cheerio.load(html);
  const robots = ($('meta[name="robots"]').attr("content") ?? "").toLowerCase();
  $(
    "script,style,noscript,svg,canvas,iframe,form,input,button,nav,footer,header,[hidden],[aria-hidden='true']",
  ).remove();
  $('[class*="cookie"],[id*="cookie"],[class*="menu"],[class*="navigation"]').remove();

  const title = $("title").first().text();
  const description = $('meta[name="description"]').attr("content") ?? "";
  const blocks = $("main h1,main h2,main h3,main p,main li,article h1,article h2,article h3,article p,article li,h1,h2,h3,p,li")
    .toArray()
    .map((element) => $(element).text());
  const text = cleanLines([title, description, ...blocks].join("\n"));

  const links = new Set<string>();
  if (!robots.includes("nofollow")) {
    $("a[href]").each((_, element) => {
      const rel = ($(element).attr("rel") ?? "").toLowerCase();
      if (rel.includes("nofollow")) return;
      const href = $(element).attr("href");
      if (!href) return;
      try {
        const candidate = new URL(href, pageUrl);
        candidate.hash = "";
        if (
          candidate.origin === pageUrl.origin &&
          (candidate.protocol === "http:" || candidate.protocol === "https:") &&
          HIGH_SIGNAL_PATH.test(candidate.pathname)
        ) {
          links.add(candidate.toString());
        }
      } catch {
        // Invalid links are ignored; they are never fetched.
      }
    });
  }

  return {
    text,
    language: detectLanguage(text, $("html").attr("lang")),
    links: [...links].sort(),
    noFollow: robots.includes("nofollow"),
  };
}

