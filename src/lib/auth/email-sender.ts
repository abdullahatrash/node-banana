import { isProductionLikeRuntime } from "./features";

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
  return {
    to: input.to,
    subject: "تأكيد بريدك الإلكتروني | Verify your email",
    text: [
      "أكّد بريدك الإلكتروني لبدء إعداد مساحة العمل:",
      input.verificationUrl,
      "",
      "Verify your email address to start setting up your workspace:",
      input.verificationUrl,
    ].join("\n"),
    html: `<div dir="auto"><p>أكّد بريدك الإلكتروني لبدء إعداد مساحة العمل.</p><p><a href="${safeUrl}">تأكيد البريد الإلكتروني</a></p><hr><p>Verify your email address to start setting up your workspace.</p><p><a href="${safeUrl}">Verify email</a></p></div>`,
  };
}

