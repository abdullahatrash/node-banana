export const GUIDE_ENTRIES = [
  { id: "workspace-activation", version: 1, titleKey: "workspace", summaryKey: "workspaceSummary", href: "/dashboard", transcriptKeys: ["workspace1", "workspace2", "workspace3"] },
  { id: "brand-context", version: 1, titleKey: "brand", summaryKey: "brandSummary", href: "/brand", transcriptKeys: ["brand1", "brand2", "brand3"] },
  { id: "inspiration-blitz", version: 1, titleKey: "inspiration", summaryKey: "inspirationSummary", href: "/inspiration", transcriptKeys: ["inspiration1", "inspiration2", "inspiration3"] },
  { id: "content-production", version: 1, titleKey: "content", summaryKey: "contentSummary", href: "/content", transcriptKeys: ["content1", "content2", "content3"] },
  { id: "publishing", version: 1, titleKey: "publishing", summaryKey: "publishingSummary", href: "/calendar", transcriptKeys: ["publishing1", "publishing2", "publishing3"] },
  { id: "recovery", version: 1, titleKey: "recovery", summaryKey: "recoverySummary", href: "/studio/operations", transcriptKeys: ["recovery1", "recovery2", "recovery3"] },
] as const;

export const ROADMAP_ITEMS = [
  { id: "roadmap-analytics-refresh", status: "committed", target: "2026-Q4", titleKey: "analytics", descriptionKey: "analyticsDescription" },
  { id: "roadmap-persona-providers", status: "in_progress", target: "2026-Q4", titleKey: "personas", descriptionKey: "personasDescription" },
  { id: "roadmap-mena-channels", status: "research", target: null, titleKey: "channels", descriptionKey: "channelsDescription" },
] as const;

export const RELEASE_NOTES = [
  { id: "release-2026-09-workspace", version: "2026.09.1", releasedAt: "2026-09-04", factKeys: ["unifiedShell", "dashboard", "brand", "analytics"] },
  { id: "release-2026-09-creation", version: "2026.09.0", releasedAt: "2026-09-03", factKeys: ["formats", "inspiration", "automations", "library"] },
] as const;

export type SupportTab = "guide" | "feedback" | "roadmap" | "releases" | "cases";
