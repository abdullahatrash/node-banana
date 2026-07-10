import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ProviderCapabilities } from "@/lib/social/provider-interface";

const mockListSocialProviders = vi.fn<() => Promise<ProviderCapabilities[]>>();
const mockConnectSocialAccount = vi.fn();
const mockFetchAccounts = vi.fn();

vi.mock("@/lib/social/client", () => ({
  listSocialProviders: (...args: unknown[]) =>
    mockListSocialProviders(...(args as [])),
  connectSocialAccount: (...args: unknown[]) =>
    mockConnectSocialAccount(...(args as [])),
}));

vi.mock("@/store/socialAccountsStore", () => ({
  useSocialAccountsStore: () => ({ fetchAccounts: mockFetchAccounts }),
}));

function twoProviders(): ProviderCapabilities[] {
  return [
    {
      identifier: "x",
      displayName: "X",
      maxContentLength: 280,
      supportsImages: true,
      supportsVideo: false,
      supportsCarousel: false,
      requiresPageSelection: false,
      configured: true,
    },
    {
      identifier: "linkedin",
      displayName: "LinkedIn",
      maxContentLength: 3000,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: true,
      requiresPageSelection: true,
      configured: false,
    },
  ];
}

describe("PlatformPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a configured platform as connectable", async () => {
    mockListSocialProviders.mockResolvedValue(twoProviders());
    const { PlatformPicker } = await import("@/components/social/PlatformPicker");

    render(<PlatformPicker open={true} onOpenChange={() => {}} />);

    const xButton = await screen.findByRole("button", { name: /^X$/ });
    expect(xButton).not.toBeDisabled();
  });

  it("renders an unconfigured platform as disabled with an explanatory state", async () => {
    mockListSocialProviders.mockResolvedValue(twoProviders());
    const { PlatformPicker } = await import("@/components/social/PlatformPicker");

    render(<PlatformPicker open={true} onOpenChange={() => {}} />);

    const linkedinButton = await screen.findByRole("button", { name: /LinkedIn/ });
    expect(linkedinButton).toBeDisabled();
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
  });

  it("never starts an OAuth connect for an unconfigured platform", async () => {
    mockListSocialProviders.mockResolvedValue(twoProviders());
    const { PlatformPicker } = await import("@/components/social/PlatformPicker");

    render(<PlatformPicker open={true} onOpenChange={() => {}} />);

    const linkedinButton = await screen.findByRole("button", { name: /LinkedIn/ });
    fireEvent.click(linkedinButton);

    await waitFor(() => {
      expect(mockConnectSocialAccount).not.toHaveBeenCalled();
    });
  });

  it("starts an OAuth connect when a configured platform is clicked", async () => {
    mockListSocialProviders.mockResolvedValue(twoProviders());
    mockConnectSocialAccount.mockResolvedValue({ authUrl: "https://x.com/oauth" });
    const { PlatformPicker } = await import("@/components/social/PlatformPicker");

    render(<PlatformPicker open={true} onOpenChange={() => {}} />);

    const xButton = await screen.findByRole("button", { name: /^X$/ });
    fireEvent.click(xButton);

    await waitFor(() => {
      expect(mockConnectSocialAccount).toHaveBeenCalledWith("x");
    });
  });
});
