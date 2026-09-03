import { createTranslator } from "next-intl";
import type { EmailSender, TransactionalEmail } from "@/lib/auth/email-sender";
import arMessages from "@/i18n/messages/ar.json";
import enMessages from "@/i18n/messages/en.json";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function translators() {
  return {
    ar: createTranslator({ locale: "ar", messages: arMessages, namespace: "governance.notifications" }),
    en: createTranslator({ locale: "en", messages: enMessages, namespace: "governance.notifications" }),
  };
}

function bilingual(input: { to: string; subjectKey: "invitationSubject" | "reviewSubject" | "stepUpSubject"; bodyKey: "invitationBody" | "reviewBody" | "stepUpBody"; actionUrl?: string; code?: string }): TransactionalEmail {
  const { ar, en } = translators();
  const details = [input.actionUrl, input.code].filter(Boolean).join("\n");
  const htmlDetails = [input.actionUrl ? `<p><a href="${escapeHtml(input.actionUrl)}">${ar("openAction")} / ${en("openAction")}</a></p>` : "", input.code ? `<p dir="ltr"><strong>${escapeHtml(input.code)}</strong></p>` : ""].join("");
  return {
    to: input.to,
    subject: `${ar(input.subjectKey)} | ${en(input.subjectKey)}`,
    text: [ar(input.bodyKey), details, "", en(input.bodyKey), details].join("\n"),
    html: `<div><section lang="ar" dir="rtl"><p>${ar(input.bodyKey)}</p>${htmlDetails}</section><hr><section lang="en" dir="ltr"><p>${en(input.bodyKey)}</p>${htmlDetails}</section></div>`,
  };
}

export async function deliverGovernanceSecret(input: {
  sender: EmailSender;
  recipient: string;
  kind: "invitation" | "review" | "step_up";
  actionUrl?: string;
  code?: string;
}): Promise<void> {
  const keys = input.kind === "invitation"
    ? { subjectKey: "invitationSubject" as const, bodyKey: "invitationBody" as const }
    : input.kind === "review"
      ? { subjectKey: "reviewSubject" as const, bodyKey: "reviewBody" as const }
      : { subjectKey: "stepUpSubject" as const, bodyKey: "stepUpBody" as const };
  await input.sender.send(bilingual({ to: input.recipient, ...keys, actionUrl: input.actionUrl, code: input.code }));
}

export function redactGovernanceSecrets<T extends Record<string, unknown>>(result: T): Omit<T, "invitationToken" | "reviewToken" | "verificationCode"> {
  const { invitationToken: _invitationToken, reviewToken: _reviewToken, verificationCode: _verificationCode, ...safe } = result;
  return safe;
}
