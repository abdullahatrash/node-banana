function configuredValue(value: string | undefined) {
  return Boolean(value?.trim());
}

function disclosureUrl(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Secret-free configuration projection shared by the Next.js UI and CLIs. */
export function youtubeTrendDiscoveryCapability(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.YOUTUBE_TREND_DISCOVERY_ENABLED === "true";
  const keyConfigured = configuredValue(env.YOUTUBE_DATA_API_KEY);
  const privacyUrl = disclosureUrl(env.NEXT_PUBLIC_PRIVACY_URL);
  const termsUrl = disclosureUrl(env.NEXT_PUBLIC_TERMS_URL);
  const disclosuresConfigured = Boolean(privacyUrl && termsUrl);
  return {
    enabled,
    keyConfigured,
    disclosuresConfigured,
    configured: enabled && keyConfigured && disclosuresConfigured,
    privacyUrl,
    termsUrl,
  };
}
