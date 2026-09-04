"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function EditorUpgradePage() {
  const t = useTranslations("editor");
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
        <p className="mt-2 text-neutral-400">
          {t("proRequired")}
        </p>
        <Link
          href="/simple-studio/videos"
          className="mt-4 inline-block rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
        >
          {t("back")}
        </Link>
      </div>
    </div>
  );
}
