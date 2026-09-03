import { isProductionLikeRuntime } from "./features";
import { createTranslator } from "next-intl";
import arMessages from "@/i18n/messages/ar.json";
import enMessages from "@/i18n/messages/en.json";

export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(message: TransactionalEmail): Promise<void>;
}

export class ConsoleEmailSender implements EmailSender {
  async send(message: TransactionalEmail): Promise<void> {
    const includeLinks = process.env.AUTH_ALLOW_CONSOLE_EMAIL_LINKS === "true";
    console.info("[auth-email] delivery", {
      to: message.to,
      subject: message.subject,
      text: includeLinks ? message.text : "[redacted; set AUTH_ALLOW_CONSOLE_EMAIL_LINKS=true locally]",
    });
  }
}

export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async send(message: TransactionalEmail): Promise<void> {
    const response = await this.fetchImplementation("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!response.ok) {
      throw new Error(`Transactional email delivery failed (${response.status}).`);
    }
  }
}

export function getEmailSender(): EmailSender {
  const delivery = process.env.AUTH_EMAIL_DELIVERY?.trim().toLowerCase();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.AUTH_FROM_EMAIL?.trim();
  if (delivery === "resend" || isProductionLikeRuntime()) {
    if (!apiKey || !from) {
      throw new Error(
        "RESEND_API_KEY and AUTH_FROM_EMAIL are required for production auth email delivery.",
      );
    }
    return new ResendEmailSender(apiKey, from);
  }
  return new ConsoleEmailSender();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function verificationEmail(input: {
  to: string;
  verificationUrl: string;
}): TransactionalEmail {
  const safeUrl = escapeHtml(input.verificationUrl);
  const ar = createTranslator({ locale: "ar", messages: arMessages, namespace: "auth.email" });
  const en = createTranslator({ locale: "en", messages: enMessages, namespace: "auth.email" });
  return {
    to: input.to,
    subject: `${ar("verificationSubject")} | ${en("verificationSubject")}`,
    text: [
      ar("verificationBody"),
      input.verificationUrl,
      "",
      en("verificationBody"),
      input.verificationUrl,
    ].join("\n"),
    html: `<div><section lang="ar" dir="rtl"><p>${ar("verificationBody")}</p><p><a href="${safeUrl}">${ar("verificationAction")}</a></p></section><hr><section lang="en" dir="ltr"><p>${en("verificationBody")}</p><p><a href="${safeUrl}">${en("verificationAction")}</a></p></section></div>`,
  };
}
