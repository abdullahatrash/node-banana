import type { MediaSetPurpose } from "./media-set-policy";

export interface MediaSetAssetSummary {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  eligibilityIssue: string | null;
}

export interface MediaSetSummary {
  id: string;
  title: string;
  revision: number;
  purpose: MediaSetPurpose;
  category: string;
  description: string;
  assetIds: string[];
  assets: MediaSetAssetSummary[];
  unavailableAssetIds: string[];
}

export interface MediaSetsSummary {
  sets: MediaSetSummary[];
  eligibleAssets: MediaSetAssetSummary[];
  measuredAt: string;
}
