import { getTranslations } from "next-intl/server";
import { BillingSettings } from "@/components/commercial/BillingSettings";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";
import { resolveWorkspaceMemberPermissions } from "@/lib/studio/authz";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const [access, t] = await Promise.all([
    requireOnboardingComplete("/billing"),
    getTranslations("errors"),
  ]);
  const workspaceId = access.aggregate?.session.workspaceId;
  const permissions = workspaceId
    ? await resolveWorkspaceMemberPermissions({
        workspaceId,
        userId: access.session.user.id,
      })
    : [];

  if (!permissions.includes("product:billing:read")) {
    return <main className="flex-1 p-8"><p role="alert">{t("forbidden")}</p></main>;
  }

  return (
    <main className="flex-1 overflow-y-auto">
      <BillingSettings
        canManage={permissions.includes("product:billing:manage")}
        canPurchase={permissions.includes("product:billing:purchase")}
      />
    </main>
  );
}
