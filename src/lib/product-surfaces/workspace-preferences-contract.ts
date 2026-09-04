export const WORKSPACE_CONTENT_MARKETS = [
  "SA", "AE", "EG", "QA", "KW", "BH", "OM", "JO", "LB",
  "IQ", "MA", "DZ", "TN", "LY", "YE", "PS", "SD", "SY",
] as const;

export type WorkspaceContentMarket = (typeof WORKSPACE_CONTENT_MARKETS)[number];

export const WORKSPACE_TIMEZONES = [
  "UTC",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Africa/Cairo",
  "Asia/Qatar",
  "Asia/Kuwait",
  "Asia/Bahrain",
  "Asia/Muscat",
  "Asia/Amman",
  "Asia/Beirut",
  "Asia/Baghdad",
  "Africa/Casablanca",
  "Africa/Algiers",
  "Africa/Tunis",
  "Africa/Tripoli",
  "Asia/Aden",
  "Asia/Gaza",
  "Africa/Khartoum",
  "Asia/Damascus",
] as const;

export const MARKET_DEFAULT_TIMEZONE: Record<WorkspaceContentMarket, string> = {
  SA: "Asia/Riyadh",
  AE: "Asia/Dubai",
  EG: "Africa/Cairo",
  QA: "Asia/Qatar",
  KW: "Asia/Kuwait",
  BH: "Asia/Bahrain",
  OM: "Asia/Muscat",
  JO: "Asia/Amman",
  LB: "Asia/Beirut",
  IQ: "Asia/Baghdad",
  MA: "Africa/Casablanca",
  DZ: "Africa/Algiers",
  TN: "Africa/Tunis",
  LY: "Africa/Tripoli",
  YE: "Asia/Aden",
  PS: "Asia/Gaza",
  SD: "Africa/Khartoum",
  SY: "Asia/Damascus",
};

export type WorkspaceWeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface WorkspaceCalendarPreferences {
  contentMarket: WorkspaceContentMarket;
  timezone: string;
  weekStartsOn: WorkspaceWeekStart;
}

export function isWorkspaceContentMarket(value: unknown): value is WorkspaceContentMarket {
  return typeof value === "string" && WORKSPACE_CONTENT_MARKETS.includes(value as WorkspaceContentMarket);
}
