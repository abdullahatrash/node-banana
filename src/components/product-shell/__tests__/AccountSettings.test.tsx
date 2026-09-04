import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { AccountSettings } from "../AccountSettings";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(), replace: vi.fn(), listAccounts: vi.fn(), listSessions: vi.fn(),
  updateUser: vi.fn(), changeEmail: vi.fn(), changePassword: vi.fn(), unlinkAccount: vi.fn(),
  linkSocial: vi.fn(), revokeOtherSessions: vi.fn(), revokeSession: vi.fn(), signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }));
vi.mock("@/lib/auth/client", () => ({ authClient: mocks }));

const accounts = [
  { id: "credential-1", providerId: "credential", accountId: "alice@example.test", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "google-1", providerId: "google", accountId: "google-subject", createdAt: "2026-02-01T00:00:00.000Z" },
];
const sessions = [
  { id: "current-session", token: "current-token", createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-08T00:00:00.000Z", ipAddress: "127.0.0.1", userAgent: "Current browser" },
  { id: "other-session", token: "other-token", createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-08T00:00:00.000Z", ipAddress: "203.0.113.1", userAgent: "Other browser" },
];

describe("AccountSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAccounts.mockResolvedValue({ data: accounts, error: null });
    mocks.listSessions.mockResolvedValue({ data: sessions, error: null });
    for (const method of [mocks.updateUser, mocks.changeEmail, mocks.changePassword, mocks.unlinkAccount, mocks.revokeOtherSessions, mocks.revokeSession, mocks.signOut]) method.mockResolvedValue({ data: { status: true }, error: null });
  });

  it("updates the personal profile and keeps identity separate from workspace lifecycle", async () => {
    const user = userEvent.setup();
    render(<I18nTestProvider locale="en"><AccountSettings initialUser={{ name: "Alice", email: "alice@example.test", emailVerified: true }} currentSessionId="current-session" enabledSocialProviders={["google", "github"]} /></I18nTestProvider>);
    const name = screen.getByRole("textbox", { name: "Display name" });
    await user.clear(name); await user.type(name, "Alice Updated");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(mocks.updateUser).toHaveBeenCalledWith({ name: "Alice Updated" });
    expect(await screen.findByText("Profile updated.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Workspace export and closure" })).toHaveAttribute("href", "/settings?section=data");
  });

  it("changes password with other-session revocation and exposes session controls", async () => {
    const user = userEvent.setup();
    render(<I18nTestProvider locale="en"><AccountSettings initialUser={{ name: "Alice", email: "alice@example.test", emailVerified: true }} currentSessionId="current-session" enabledSocialProviders={[]} /></I18nTestProvider>);
    await user.click(screen.getByRole("tab", { name: "Security" }));
    await user.type(screen.getByLabelText("Current password"), "old-password");
    await user.type(screen.getByLabelText("New password"), "new-password");
    await user.type(screen.getByLabelText("Confirm new password"), "new-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(mocks.changePassword).toHaveBeenCalledWith({ currentPassword: "old-password", newPassword: "new-password", revokeOtherSessions: true });
    expect(await screen.findByText("Password changed and other sessions were revoked.")).toBeInTheDocument();
    expect(screen.getByText("This session")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    expect(mocks.revokeSession).toHaveBeenCalledWith({ token: "other-token" });
  });

  it("renders an Arabic-first direction-aware account surface", async () => {
    const { container } = render(<I18nTestProvider locale="ar"><AccountSettings initialUser={{ name: "أليس", email: "alice@example.test", emailVerified: true }} currentSessionId="current-session" enabledSocialProviders={[]} /></I18nTestProvider>);
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("tab", { name: "الملف الشخصي" })).toBeInTheDocument();
    expect(await screen.findByText("البريد وكلمة المرور")).toBeInTheDocument();
  });
});
