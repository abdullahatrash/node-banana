"use client"

import Link from "next/link"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "next-intl"

export function SocialHeaderActions() {
  const t = useTranslations("shell")

  return (
          <Button size="sm" render={<Link href="/social/compose" />} nativeButton={false}>
            <PlusIcon className="size-4" />
            {t("actions.newPost")}
          </Button>
  )
}
