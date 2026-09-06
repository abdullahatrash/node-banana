"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { getActiveWorkspaceId } from "@/lib/studio/client";

export function SupportExportButton({ recordId }: { recordId: string }) {
  const rawT = useTranslations();
  const t = rawT as unknown as (key: string) => string;
  const [busy, setBusy] = useState(false);
  async function download() {
    const workspaceId = getActiveWorkspaceId();
    if (!workspaceId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/product-support/${encodeURIComponent(recordId)}/export`, { headers: { "x-workspace-id": workspaceId }, cache: "no-store" });
      if (!response.ok) return;
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `support-${recordId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }
  return <button type="button" onClick={download} disabled={busy} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 disabled:opacity-60">{busy && <LoaderCircle className="size-3 animate-spin" />}{t("product.library.download")}</button>;
}
