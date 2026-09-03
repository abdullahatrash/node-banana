import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SimpleStudioAppSidebar } from "../SimpleStudioAppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { I18nTestProvider } from "@/test/i18n";

// Mock next/navigation to control pathname
vi.mock("next/navigation", () => ({
  usePathname: () => "/simple-studio/images",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Mock authClient.useSession to provide a stable user
vi.mock("@/lib/auth/client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { name: "Test User", email: "test@example.com", image: "" } },
    }),
  },
}));

function renderSidebar() {
  return render(
    <I18nTestProvider locale="en">
      <SidebarProvider>
        <SimpleStudioAppSidebar />
      </SidebarProvider>
    </I18nTestProvider>,
  );
}

describe("SimpleStudioAppSidebar", () => {
  it("renders all five nav items", () => {
    renderSidebar();
    expect(screen.getByText("Images")).toBeInTheDocument();
    expect(screen.getByText("Videos")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Library")).toBeInTheDocument();
    expect(screen.getByText("Prompt Library")).toBeInTheDocument();
  });

  it("renders Create and Browse group labels", () => {
    renderSidebar();
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByText("Browse")).toBeInTheDocument();
  });

  it("renders the AppSwitcher trigger with Simple Studio label", () => {
    renderSidebar();
    expect(screen.getByText("Simple Studio")).toBeInTheDocument();
  });

  it("renders the user's name in the footer", () => {
    renderSidebar();
    expect(screen.getByText("Test User")).toBeInTheDocument();
  });
});
