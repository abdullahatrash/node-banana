export type CommercialLocale = "ar" | "en";

export type DefaultBillingPlan = {
  planId: "free" | "starter" | "growth" | "pro";
  version: 1;
  status: "active";
  authoredName: Record<CommercialLocale, string>;
  currency: "USD";
  priceMinor: number;
  billingInterval: "month";
  taxMode: "inclusive";
  trialDays: number;
  trialCreditUnits: number;
  entitlements: {
    generationCreditsPerPeriod: number;
    workspaceSeats: number;
    connectedChannels: number;
    activeAutomations: number;
    apiAccess: boolean;
    creatorPersonas: boolean;
    managedChannelOnboarding: boolean;
  };
  termsDigest: `sha256:${string}`;
  effectiveAt: string;
};

export type DefaultCreditPack = {
  packId: "boost-100" | "scale-500" | "studio-1200";
  version: 1;
  status: "active";
  authoredName: Record<CommercialLocale, string>;
  creditUnits: number;
  priceMinor: number;
  taxMinor: 0;
  currency: "USD";
  termsDigest: `sha256:${string}`;
  effectiveAt: string;
};

const EFFECTIVE_AT = "2026-09-01T00:00:00.000Z";

/**
 * Public defaults and the database seed are one immutable commercial release.
 * Changing price, allowance, trial, or entitlement terms requires a new version
 * and a new digest; never edit a published version in place.
 */
export const DEFAULT_BILLING_PLANS = [
  {
    planId: "free",
    version: 1,
    status: "active",
    authoredName: { ar: "مجانية", en: "Free" },
    currency: "USD",
    priceMinor: 0,
    billingInterval: "month",
    taxMode: "inclusive",
    trialDays: 0,
    trialCreditUnits: 0,
    entitlements: {
      generationCreditsPerPeriod: 10,
      workspaceSeats: 1,
      connectedChannels: 2,
      activeAutomations: 0,
      apiAccess: false,
      creatorPersonas: false,
      managedChannelOnboarding: false,
    },
    termsDigest: "sha256:e7982e9ac70a65497ce186e5a4dd12a10420ed28c5aa04d5fb4b2755b9f52b16",
    effectiveAt: EFFECTIVE_AT,
  },
  {
    planId: "starter",
    version: 1,
    status: "active",
    authoredName: { ar: "البداية", en: "Starter" },
    currency: "USD",
    priceMinor: 2_900,
    billingInterval: "month",
    taxMode: "inclusive",
    trialDays: 7,
    trialCreditUnits: 25,
    entitlements: {
      generationCreditsPerPeriod: 250,
      workspaceSeats: 3,
      connectedChannels: 5,
      activeAutomations: 3,
      apiAccess: false,
      creatorPersonas: false,
      managedChannelOnboarding: false,
    },
    termsDigest: "sha256:1dfd198acc1a6579eab3b1a90aeb883ba61cd45aea5ed8f238c4f5fe3abf7d1f",
    effectiveAt: EFFECTIVE_AT,
  },
  {
    planId: "growth",
    version: 1,
    status: "active",
    authoredName: { ar: "النمو", en: "Growth" },
    currency: "USD",
    priceMinor: 4_900,
    billingInterval: "month",
    taxMode: "inclusive",
    trialDays: 7,
    trialCreditUnits: 50,
    entitlements: {
      generationCreditsPerPeriod: 500,
      workspaceSeats: 10,
      connectedChannels: 15,
      activeAutomations: 15,
      apiAccess: true,
      creatorPersonas: true,
      managedChannelOnboarding: true,
    },
    termsDigest: "sha256:890649c8045a5e5049009014ca24bcb56a89fcfa6f7faae5af61a8800460a46b",
    effectiveAt: EFFECTIVE_AT,
  },
  {
    planId: "pro",
    version: 1,
    status: "active",
    authoredName: { ar: "الاحترافية", en: "Pro" },
    currency: "USD",
    priceMinor: 14_900,
    billingInterval: "month",
    taxMode: "inclusive",
    trialDays: 7,
    trialCreditUnits: 100,
    entitlements: {
      generationCreditsPerPeriod: 2_000,
      workspaceSeats: 25,
      connectedChannels: 50,
      activeAutomations: 50,
      apiAccess: true,
      creatorPersonas: true,
      managedChannelOnboarding: true,
    },
    termsDigest: "sha256:a4c65270297f9186fde68d39da79b101bffaa1e4e0be53b7228cd89445907e60",
    effectiveAt: EFFECTIVE_AT,
  },
] as const satisfies readonly DefaultBillingPlan[];

export const DEFAULT_CREDIT_PACKS = [
  {
    packId: "boost-100",
    version: 1,
    status: "active",
    authoredName: { ar: "دفعة 100", en: "Boost 100" },
    creditUnits: 100,
    priceMinor: 1_200,
    taxMinor: 0,
    currency: "USD",
    termsDigest: "sha256:f17f69c0b8da87b042c56cf28652661d5eddbde0a13b0c896b2dd53f8be7a151",
    effectiveAt: EFFECTIVE_AT,
  },
  {
    packId: "scale-500",
    version: 1,
    status: "active",
    authoredName: { ar: "دفعة 500", en: "Scale 500" },
    creditUnits: 500,
    priceMinor: 3_900,
    taxMinor: 0,
    currency: "USD",
    termsDigest: "sha256:4a0d5ac2668760a1906e333230303345b3d071712e5e5d02f8c1302effb78428",
    effectiveAt: EFFECTIVE_AT,
  },
  {
    packId: "studio-1200",
    version: 1,
    status: "active",
    authoredName: { ar: "دفعة الاستوديو 1200", en: "Studio 1200" },
    creditUnits: 1_200,
    priceMinor: 7_900,
    taxMinor: 0,
    currency: "USD",
    termsDigest: "sha256:414d83e407bdf41e7e459be7323af055d2ebb4df38b8e1993edc10a4d78c7eac",
    effectiveAt: EFFECTIVE_AT,
  },
] as const satisfies readonly DefaultCreditPack[];
