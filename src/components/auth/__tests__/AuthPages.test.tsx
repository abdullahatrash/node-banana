import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import ar from "@/i18n/messages/ar.json";
import SignInPage from "@/app/sign-in/page";
import SignUpPage from "@/app/sign-up/page";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(), signUp: vi.fn(), replace: vi.fn(),
  query: new URLSearchParams(), session: vi.fn(),
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { useSession: mocks.session, signIn: { email: mocks.signIn }, signUp: { email: mocks.signUp } },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => mocks.query,
}));
vi.mock("@/components/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));

function show(Page: typeof SignInPage, locale: "en" | "ar" = "en") {
  return render(<NextIntlClientProvider locale={locale} messages={locale === "en" ? en : ar} timeZone="UTC"><Page /></NextIntlClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.query = new URLSearchParams();
  mocks.session.mockReturnValue({ data: null, isPending: false });
  mocks.signIn.mockResolvedValue({});
  mocks.signUp.mockResolvedValue({});
});

describe("auth page behavior", () => {
  it("preserves the requested destination after sign in", async () => {
    mocks.query.set("next", "/social/compose");
    show(SignInPage);
    fireEvent.change(screen.getByLabelText(en.common.email), { target: { value: "person@example.com" } });
    fireEvent.change(screen.getByLabelText(en.common.password), { target: { value: "a-test-password" } });
    fireEvent.click(screen.getByRole("button", { name: en.auth.signIn.submit }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith({
      email: "person@example.com", password: "a-test-password",
      callbackURL: new URL("/onboarding?next=%2Fsocial%2Fcompose", window.location.origin).toString(),
    }));
    expect(mocks.replace).toHaveBeenCalledWith("/onboarding?next=%2Fsocial%2Fcompose");
  });

  it("keeps unverified sign-ins on the email verification path", async () => {
    mocks.signIn.mockResolvedValue({ error: { code: "EMAIL_NOT_VERIFIED", status: 403 } });
    show(SignInPage);
    fireEvent.change(screen.getByLabelText(en.common.email), { target: { value: "person@example.com" } });
    fireEvent.change(screen.getByLabelText(en.common.password), { target: { value: "a-test-password" } });
    fireEvent.click(screen.getByRole("button", { name: en.auth.signIn.submit }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/verify-email?email=person%40example.com&next=%2Fdashboard"));
  });

  it("keeps the identity-erasure notice visible", () => {
    mocks.query.set("erased", "1");
    show(SignInPage);
    expect(screen.getByRole("status")).toHaveTextContent(en.auth.signIn.erased);
  });

  it("signs up with the existing password policy and requires email verification", async () => {
    show(SignUpPage);
    const password = screen.getByLabelText(en.common.password);
    expect(password).toHaveAttribute("minlength", "8");
    expect(password).toHaveAttribute("maxlength", "128");
    expect(password).toHaveAccessibleDescription(en.auth.shell.passwordHint);
    fireEvent.change(screen.getByLabelText(en.auth.signUp.name), { target: { value: "Test Person" } });
    fireEvent.change(screen.getByLabelText(en.common.email), { target: { value: "person@example.com" } });
    fireEvent.change(password, { target: { value: "a-test-password" } });
    fireEvent.click(screen.getByRole("button", { name: en.auth.signUp.submit }));
    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledWith({
      name: "Test Person", email: "person@example.com", password: "a-test-password",
      callbackURL: new URL("/onboarding", window.location.origin).toString(),
    }));
    expect(mocks.replace).toHaveBeenCalledWith("/verify-email?email=person%40example.com");
  });

  it.each(["en", "ar"] as const)("uses accessible password controls and authored failures in %s", async (locale) => {
    const messages = locale === "ar" ? ar : en;
    mocks.signIn.mockResolvedValue({ error: { message: "Raw provider error" } });
    show(SignInPage, locale);
    const password = screen.getByLabelText(messages.common.password);
    fireEvent.change(screen.getByLabelText(messages.common.email), { target: { value: "person@example.com" } });
    fireEvent.change(password, { target: { value: "a-test-password" } });
    fireEvent.click(screen.getByRole("button", { name: messages.auth.shell.showPassword }));
    expect(password).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: messages.auth.shell.hidePassword }));
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: messages.auth.signIn.submit }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.auth.signIn.failed);
    expect(screen.queryByText("Raw provider error")).not.toBeInTheDocument();
  });
});
