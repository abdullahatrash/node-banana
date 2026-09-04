import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductShell } from "../ProductShell";
import { I18nTestProvider } from "@/test/i18n";
import type { ProductShellContext } from "@/lib/product-shell/server";

const pathname = vi.fn(() => "/dashboard");
const router = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
};

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
  useRouter: () => router,
}));

vi.mock("@/lib/auth/client", () => ({
  authClient: { signOut: vi.fn() },
}));
vi.mock("@/components/release-control/ServiceStatusBanner", () => ({
  ServiceStatusBanner: () => null,
}));

const context: ProductShellContext = {
  user: {
    name: "Noura Alnajjar",
    email: "noura@example.com",
    avatar: "",
  },
  workspaces: [
    { id: "workspace-1", name: "Noura Studio", slug: "noura", role: "owner" },
    { id: "workspace-2", name: "Client Brand", slug: "client", role: "admin" },
  ],
  initialWorkspaceId: "workspace-1",
};

function renderShell(locale: "ar" | "en" = "en") {
  return render(
    <I18nTestProvider locale={locale}>
      <ProductShell context={context}>
        <p>route content</p>
      </ProductShell>
    </I18nTestProvider>,
  );
}

describe("ProductShell", () => {
  beforeEach(() => {
    pathname.mockReturnValue("/dashboard");
    router.push.mockReset();
    router.replace.mockReset();
    router.refresh.mockReset();
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  });

  it("renders every live primary and contextual capability as a link", () => {
    renderShell();

    expect(screen.getByRole("navigation", { name: "Product navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Automations" })).toHaveAttribute("href", "/automations");
    expect(screen.getByRole("link", { name: "AI Studio" })).toHaveAttribute("href", "/ai-studio");
    expect(screen.getByRole("link", { name: "Content" })).toHaveAttribute("href", "/content");
    expect(screen.getByRole("link", { name: "Compose" })).toHaveAttribute("href", "/compose");
    expect(screen.getByRole("link", { name: "Approvals" })).toHaveAttribute("href", "/approvals");
    expect(screen.getByRole("link", { name: "Deliveries" })).toHaveAttribute("href", "/deliveries");
    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute("href", "/agents");
    expect(screen.getByRole("link", { name: "Observability" })).toHaveAttribute("href", "/studio/observability");
    expect(screen.getByRole("link", { name: "Release quality" })).toHaveAttribute("href", "/studio/release-quality");
    expect(screen.getByRole("link", { name: "Prompt Library" })).toHaveAttribute("href", "/simple-studio/prompt-library");
    expect(screen.getByRole("link", { name: "Events" })).toHaveAttribute("href", "/social/events");
    expect(screen.getByRole("link", { name: "Copilot" })).toHaveAttribute("href", "/social/copilot");
    expect(screen.getByRole("link", { name: "Webhooks" })).toHaveAttribute("href", "/social/plugs");
    expect(screen.getByText("route content")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="sidebar-inset"]')?.tagName).toBe(
      "DIV",
    );
  });

  it("marks legacy descendants active under the canonical link", () => {
    pathname.mockReturnValue("/social/compose/post-1");
    renderShell();
    expect(screen.getByRole("link", { name: "Compose" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("gives an exact contextual destination sole current-page ownership", () => {
    pathname.mockReturnValue("/social/posts/post-1");
    renderShell();

    expect(screen.getByRole("link", { name: "Posts" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Content" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it("links the committed inspiration, influencer, and Brand destinations", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Inspiration" })).toHaveAttribute("href", "/inspiration");
    expect(screen.getByRole("link", { name: "Influencers" })).toHaveAttribute("href", "/influencers");
    expect(screen.getByRole("link", { name: "Brand" })).toHaveAttribute("href", "/brand");
  });

  it("renders Arabic labels and places the RTL sidebar on the right", () => {
    renderShell("ar");
    expect(screen.getByRole("navigation", { name: "التنقل في المنتج" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "لوحة التحكم" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(document.querySelector('[data-slot="sidebar"][data-side="right"]')).toBeTruthy();
  });

  it("bootstraps a validated workspace context", async () => {
    window.localStorage.setItem("node-banana-active-workspace-id", "unknown-workspace");
    renderShell();
    expect(screen.getByText("Noura Studio")).toBeInTheDocument();
    await waitFor(() =>
      expect(window.localStorage.getItem("node-banana-active-workspace-id")).toBe(
        "workspace-1",
      ),
    );
  });

  it("does not silently select the first authorized workspace", async () => {
    render(
      <I18nTestProvider locale="en">
        <ProductShell context={{ ...context, initialWorkspaceId: null }}>
          <p>route content</p>
        </ProductShell>
      </I18nTestProvider>,
    );

    expect(
      screen.getByRole("button", { name: /Select workspace/ }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        window.localStorage.getItem("node-banana-active-workspace-id"),
      ).toBeNull(),
    );
  });

  it("supports the desktop keyboard shortcut", () => {
    renderShell();
    const desktopSidebar = document.querySelector('[data-slot="sidebar"][data-state]');
    expect(desktopSidebar).toHaveAttribute("data-state", "expanded");
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(desktopSidebar).toHaveAttribute("data-state", "collapsed");
  });

  it("keeps the desktop shell visible at the tablet breakpoint", () => {
    Object.defineProperty(window, "innerWidth", { value: 768, configurable: true });
    renderShell();
    expect(document.querySelector('[data-slot="sidebar"][data-state]')).toHaveAttribute(
      "data-side",
      "left",
    );
  });

  it("opens a localized 390px mobile drawer", async () => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    renderShell("ar");
    const trigger = screen.getByRole("button", { name: "فتح أو إغلاق التنقل" });
    fireEvent.click(trigger);
    expect(
      await screen.findByRole("heading", { name: "تنقل مساحة العمل" }),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-mobile="true"][data-side="right"]')).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "تنقل مساحة العمل" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("wires account navigation instead of rendering a dead menu action", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(
      screen.getByRole("button", {
        name: /Noura Alnajjarnoura@example.com/,
      }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Account" }));
    expect(router.push).toHaveBeenCalledWith("/settings");
  });
});
