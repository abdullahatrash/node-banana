/** Browser-safe catalog shared by governance UI and server-side portability workers. */
export const GOVERNANCE_PORTABLE_KINDS = [
  "media",
  "content_revision",
  "prompt",
  "brand_source",
  "calendar_plan",
  "caption",
  "platform_observation",
  "platform_export_metadata",
] as const;

export type GovernancePortableKind = (typeof GOVERNANCE_PORTABLE_KINDS)[number];
