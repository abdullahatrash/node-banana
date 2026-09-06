"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2Icon, Loader2Icon, UsersIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

export function InvitationAcceptanceClient({ invitationToken }: { invitationToken: string }) {
  const t = useTranslations("governance.invitation");
  const [status, setStatus] = useState<"ready" | "accepted" | "signin" | "failed">("ready");
  const [pending, startTransition] = useTransition();
  function accept() {
    startTransition(async () => {
      const response = await fetch(`/api/governance/invitations/${encodeURIComponent(invitationToken)}/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) });
      if (response.ok) setStatus("accepted");
      else setStatus(response.status === 401 ? "signin" : "failed");
    });
  }
  return <section className="w-full max-w-lg rounded-2xl border bg-card p-6 text-center shadow-sm sm:p-8">
    {status === "accepted" ? <CheckCircle2Icon className="mx-auto size-10 text-emerald-600" /> : <UsersIcon className="mx-auto size-10 text-primary" />}
    <h1 className="mt-4 text-2xl font-semibold">{t(status === "accepted" ? "acceptedTitle" : "title")}</h1>
    <p className="mt-2 text-sm text-muted-foreground">{t(status === "accepted" ? "acceptedDescription" : status === "signin" ? "signinDescription" : status === "failed" ? "failedDescription" : "description")}</p>
    {status === "ready" || status === "failed" ? <Button className="mt-6" onClick={accept} disabled={pending}>{pending ? <Loader2Icon className="size-4 animate-spin" /> : null}{t("accept")}</Button> : null}
    {status === "signin" ? <Link className={buttonVariants({ className: "mt-6" })} href={`/sign-in?callbackURL=${encodeURIComponent(`/invitations/${invitationToken}`)}`}>{t("signIn")}</Link> : null}
    {status === "accepted" ? <Link className={buttonVariants({ className: "mt-6" })} href="/settings">{t("openWorkspace")}</Link> : null}
  </section>;
}
