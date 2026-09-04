import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConsoleEmailSender,
  ResendEmailSender,
  changeEmailConfirmationEmail,
  verificationEmail,
} from "../email-sender";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AUTH_ALLOW_CONSOLE_EMAIL_LINKS;
});

describe("auth email sender", () => {
  it("sends a bilingual verification message through Resend", async () => {
    const fetchImplementation = vi.fn(async () => new Response(null, { status: 202 }));
    const sender = new ResendEmailSender(
      "secret",
      "Tasmeem <auth@example.com>",
      fetchImplementation,
    );
    await sender.send(
      verificationEmail({
        to: "user@example.com",
        verificationUrl: "https://app.example.com/api/auth/verify-email?token=secret",
      }),
    );
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [, request] = fetchImplementation.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(request?.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      from: "Tasmeem <auth@example.com>",
      to: ["user@example.com"],
    });
  });

  it("throws a non-sensitive provider error", async () => {
    const sender = new ResendEmailSender(
      "secret",
      "auth@example.com",
      vi.fn(async () => new Response("provider internals", { status: 400 })),
    );
    await expect(
      sender.send(
        verificationEmail({
          to: "user@example.com",
          verificationUrl: "https://app.example.com/verify?token=secret",
        }),
      ),
    ).rejects.toThrow("delivery failed (400)");
  });

  it("redacts verification links from normal console logs", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await new ConsoleEmailSender().send(
      verificationEmail({
        to: "user@example.com",
        verificationUrl: "https://app.example.com/verify?token=secret",
      }),
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain("token=secret");
  });

  it("escapes the URL used in HTML", () => {
    const message = verificationEmail({
      to: "user@example.com",
      verificationUrl: 'https://app.example.com/verify?a=1&next="><script>',
    });
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&amp;");
  });

  it("authors a bilingual current-email confirmation without injectable HTML", () => {
    const message = changeEmailConfirmationEmail({
      to: "current@example.com",
      newEmail: 'next+"><script>@example.com',
      confirmationUrl: 'https://app.example.com/change-email?token=secret&next="',
    });
    expect(message.subject).toContain("Approve your email change");
    expect(message.subject).toContain("الموافقة على تغيير البريد الإلكتروني");
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&amp;");
  });
});
