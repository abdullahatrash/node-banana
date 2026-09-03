"use client";

import { useTranslations } from "next-intl";

const copyKeys = [
  "eyebrow", "title", "subtitle", "continue", "back", "optional", "saving",
  "loading", "retry", "identityTitle", "fullName", "companyName",
  "contentLanguage", "logo", "uploadLogo", "logoHelp", "arabic", "english",
  "sourceTitle", "sourceSubtitle", "website", "description", "websitePlaceholder",
  "descriptionPlaceholder", "teamTitle", "teamSize", "revenue", "roleTitle",
  "businessTitle", "businessModel", "categories", "goalsTitle", "intent",
  "outcomes", "attributionTitle", "attributionSubtitle", "preparing",
  "preparingDetail", "profileTitle", "profileSubtitle", "acceptProfile",
  "editProfile", "saveProfile", "cancel", "sourceFailed", "sourceFailedDetail",
  "educationTitle", "educationSubtitle", "finish", "error", "changeSource",
] as const;

export function useOnboardingCopy() {
  const t = useTranslations("onboarding");
  const copy = Object.fromEntries(copyKeys.map((key) => [key, t(key)])) as {
    [Key in (typeof copyKeys)[number]]: string;
  };

  return {
    ...copy,
    educationFeatures: [
      t("educationFeatures.identity"),
      t("educationFeatures.audience"),
      t("educationFeatures.suggestion"),
    ],
    profileLabels: {
      identity: t("profileLabels.identity"), offering: t("profileLabels.offering"),
      audiences: t("profileLabels.audiences"), benefits: t("profileLabels.benefits"),
      positioning: t("profileLabels.positioning"), voice: t("profileLabels.voice"),
      angles: t("profileLabels.angles"), uncertainty: t("profileLabels.uncertainty"),
    },
    profileFields: {
      core: t("profileFields.core"), offering: t("profileFields.offering"),
      benefits: t("profileFields.benefits"), differentiators: t("profileFields.differentiators"),
      mission: t("profileFields.mission"), positioning: t("profileFields.positioning"),
      owned: t("profileFields.owned"), descriptors: t("profileFields.descriptors"),
      do: t("profileFields.do"), doNot: t("profileFields.doNot"),
      claims: t("profileFields.claims"), topics: t("profileFields.topics"),
      angles: t("profileFields.angles"), uncertainties: t("profileFields.uncertainties"),
    },
  };
}

export function useOnboardingOptionLabels() {
  const t = useTranslations("onboarding.options");
  return {
    teamSize: { solo: t("teamSize.solo"), "2_5": t("teamSize.2_5"), "6_10": t("teamSize.6_10"), "11_20": t("teamSize.11_20"), "21_50": t("teamSize.21_50"), "50_plus": t("teamSize.50_plus") },
    revenue: { pre_revenue: t("revenue.pre_revenue"), "1_1000_usd": t("revenue.1_1000_usd"), "1000_10000_usd": t("revenue.1000_10000_usd"), "10000_50000_usd": t("revenue.10000_50000_usd"), "50000_500000_usd": t("revenue.50000_500000_usd"), "500000_plus_usd": t("revenue.500000_plus_usd") },
    roles: { founder: t("roles.founder"), social_media_manager: t("roles.social_media_manager"), marketing_manager: t("roles.marketing_manager"), agency_owner: t("roles.agency_owner"), freelancer: t("roles.freelancer"), product_manager: t("roles.product_manager"), content_creator: t("roles.content_creator"), growth_manager: t("roles.growth_manager"), other: t("roles.other") },
    models: { b2b: t("models.b2b"), b2c: t("models.b2c"), both: t("models.both") },
    categories: { ecommerce: t("categories.ecommerce"), saas: t("categories.saas"), agency: t("categories.agency"), services: t("categories.services"), marketplace: t("categories.marketplace"), media_content: t("categories.media_content"), mobile_app: t("categories.mobile_app"), other: t("categories.other") },
    intents: { marketing_now: t("intents.marketing_now"), marketing_later: t("intents.marketing_later"), curious: t("intents.curious") },
    outcomes: { save_time: t("outcomes.save_time"), more_social_views: t("outcomes.more_social_views"), drive_site_traffic: t("outcomes.drive_site_traffic"), generate_revenue: t("outcomes.generate_revenue"), learn_content_marketing: t("outcomes.learn_content_marketing"), other: t("outcomes.other") },
    sources: { x: t("sources.x"), linkedin: t("sources.linkedin"), youtube: t("sources.youtube"), tiktok: t("sources.tiktok"), instagram: t("sources.instagram"), facebook: t("sources.facebook"), podcast: t("sources.podcast"), newsletter: t("sources.newsletter"), google: t("sources.google"), reddit: t("sources.reddit"), referral: t("sources.referral"), other: t("sources.other") },
  };
}
