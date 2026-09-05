"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, Share2Icon } from "lucide-react";
import { useTranslations } from "next-intl";

export function ReferralShareActions({ url }: { url: string }) {
  const t = useTranslations("product.referrals");
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  async function share() {
    if (navigator.share) {
      await navigator.share({ title: t("shareTitle"), text: t("shareText"), url });
      return;
    }
    await copy();
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={copy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold">
        {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
        {copied ? t("copied") : t("copy")}
      </button>
      <button type="button" onClick={share} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
        <Share2Icon className="size-4" />
        {t("share")}
      </button>
    </div>
  );
}
