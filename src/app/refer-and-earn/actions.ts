"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { COMMERCIAL } from "@/lib/commercial/production";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";
import { resolveWorkspaceMemberPermissions } from "@/lib/studio/authz";

async function requireReferralManager() {
  const access = await requireOnboardingComplete("/refer-and-earn");
  const workspaceId = access.aggregate?.session.workspaceId;
  if (!workspaceId) throw new Error("WORKSPACE_REQUIRED");
  const permissions = await resolveWorkspaceMemberPermissions({ workspaceId, userId: access.session.user.id });
  if (!permissions.includes("product:billing:manage")) throw new Error("REFERRAL_MANAGER_REQUIRED");
  return { workspaceId, userId: access.session.user.id };
}

export async function createReferralCodeAction(formData: FormData) {
  const input = z.object({ rewardMode: z.enum(["generation_credit", "cash"]), idempotencyKey: z.string().min(8).max(200) }).parse(Object.fromEntries(formData));
  const context = await requireReferralManager();
  await COMMERCIAL.createReferralCode({ ...context, ...input });
  revalidatePath("/refer-and-earn");
}

export async function setReferralCodeStatusAction(formData: FormData) {
  const input = z.object({ codeId: z.string().uuid(), status: z.enum(["active", "paused", "closed"]), idempotencyKey: z.string().min(8).max(200) }).parse(Object.fromEntries(formData));
  const { workspaceId } = await requireReferralManager();
  await COMMERCIAL.setReferralCodeStatus({ workspaceId, ...input });
  revalidatePath("/refer-and-earn");
}

export async function saveReferralRecipientProfileAction(formData: FormData) {
  const input = z.object({
    rewardPreference: z.enum(["generation_credit", "cash"]),
    legalCountry: z.string().trim().regex(/^[A-Za-z]{2}$/).optional().or(z.literal("")),
    payoutCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/).optional().or(z.literal("")),
    idempotencyKey: z.string().min(8).max(200),
  }).parse(Object.fromEntries(formData));
  const context = await requireReferralManager();
  await COMMERCIAL.saveReferralRecipientProfile({ ...context, rewardPreference: input.rewardPreference, legalCountry: input.legalCountry || null, payoutCurrency: input.payoutCurrency || null, termsAccepted: formData.get("termsAccepted") === "on", idempotencyKey: input.idempotencyKey });
  revalidatePath("/refer-and-earn");
}

export async function requestReferralPayoutAction(formData: FormData) {
  const input = z.object({ idempotencyKey: z.string().min(8).max(200) }).parse(Object.fromEntries(formData));
  const context = await requireReferralManager();
  await COMMERCIAL.requestReferralPayout({ ...context, idempotencyKey: input.idempotencyKey });
  revalidatePath("/refer-and-earn");
}
