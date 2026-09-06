import type { AppLocale } from "@/i18n/config";

export async function saveInterfaceLocalePreference(input: {
  locale: AppLocale;
  workspaceId: string | null;
}): Promise<void> {
  const response = await fetch("/api/preferences/locale", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.workspaceId ? { "x-workspace-id": input.workspaceId } : {}),
    },
    body: JSON.stringify({ locale: input.locale }),
    keepalive: true,
  });
  if (!response.ok) throw new Error("INTERFACE_LOCALE_SAVE_FAILED");
}
