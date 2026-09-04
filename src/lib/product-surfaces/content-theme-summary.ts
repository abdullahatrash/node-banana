export interface CuratedThemeSummary {
  catalogId: string;
  themeId: string;
  revision: number;
  authoredName: { ar: string; en: string };
  authoredDescription: { ar: string; en: string };
  culturalNote: { ar: string; en: string };
  palette: string[];
  digest: string;
  active: boolean;
}

export interface RemixMediaSetSummary {
  id: string;
  title: string;
  revision: number;
  assetCount: number;
  purpose: "general" | "demo_videos";
}

export interface WorkspaceRemixSummary {
  themes: CuratedThemeSummary[];
  activeThemeCount: number;
  themeLimit: number;
  mediaSets: RemixMediaSetSummary[];
  measuredAt: string;
}
