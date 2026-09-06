import { createHash } from "node:crypto";

function rolloutPercent(environment: NodeJS.ProcessEnv): number {
  const parsed = Number.parseInt(environment.ONBOARDING_ROLLOUT_PERCENT ?? "100", 10);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 100;
}

function cohortBucket(userId: string): number {
  const digest = createHash("sha256").update(`onboarding-v1:${userId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export function shouldRequireOnboarding(
  userId: string,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environment.ONBOARDING_KILL_SWITCH === "true") return false;
  const internalIds = new Set(
    (environment.ONBOARDING_INTERNAL_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (internalIds.has(userId)) return true;
  return cohortBucket(userId) < rolloutPercent(environment);
}
