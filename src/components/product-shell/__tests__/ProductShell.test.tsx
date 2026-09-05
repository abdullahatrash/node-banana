import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("../WorkspaceNotificationCenter", () => ({ WorkspaceNotificationCenter: () => null }));

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
  canReadBilling: true,
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
  afterEach(() => vi.unstubAllGlobals());

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
    expect(screen.getByRole("link", { name: "Plans & credits" })).toHaveAttribute("href", "/billing");
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
    expect(screen.queryByRole("link", { name: "Integrations" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Webhooks" })).toHaveAttribute("href", "/social/plugs");
    expect(screen.getByText("route content")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="sidebar-inset"]')?.tagName).toBe(
      "DIV",
    );
  });

  it("hides workspace billing navigation without billing-read authority", () => {
    render(
      <I18nTestProvider locale="en">
        <ProductShell context={{ ...context, canReadBilling: false }}>
          <p>route content</p>
        </ProductShell>
      </I18nTestProvider>,
    );

    expect(screen.queryByRole("link", { name: "Plans & credits" })).not.toBeInTheDocument();
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
    const sidebar = document.querySelector('[data-slot="sidebar"][data-side="right"]');
    expect(sidebar).toBeTruthy();
    expect(sidebar?.querySelector('[data-slot="sidebar-container"]')).toHaveClass("data-[side=right]:right-0");
    expect(document.querySelector('[data-slot="sidebar-inset"]')).toHaveClass("min-w-0");
    expect(document.querySelector('[data-slot="sidebar-wrapper"]')).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("button", { name: "فتح أو إغلاق التنقل" }).querySelector('[data-sidebar-icon-side="right"]')).toBeTruthy();
    expect(screen.getAllByText("noura@example.com")[0]).toHaveAttribute("dir", "ltr");
  });

  it("shows authoritative plan, trial, credits, and Upgrade state in English", async () => {
    const trialEndsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== "/api/studio/billing") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ success: true, data: {
        subscription: { state: "trialing", planId: "starter", planVersion: 1, currentPeriodEndsAt: trialEndsAt, graceEndsAt: null, merchantCustomerRef: null },
        plans: [{ planId: "free", version: 1, authoredName: { ar: "مجانية", en: "Free" } }, { planId: "starter", version: 1, authoredName: { ar: "البداية", en: "Starter" } }],
        credit: { availableUnits: 21, liabilityUnits: 0 },
        financials: { transactions: [], adjustments: [], executionHolds: [] },
      } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderShell();
    expect(await screen.findAllByText("Starter trial · 3d left")).toHaveLength(2);
    expect(screen.getByText("21 credits available")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upgrade" })).toHaveAttribute("href", "/billing");
    expect(screen.getByTestId("shell-commercial-status-compact")).toHaveAccessibleName("Manage plan and 21 available credits");
    expect(screen.getByTestId("shell-commercial-status-compact")).toHaveAttribute("href", "/billing");
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/studio/billing")).toHaveLength(1);
  });

  it("localizes authoritative Free and credit state in Arabic", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== "/api/studio/billing") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ success: true, data: {
        subscription: null,
        plans: [{ planId: "free", version: 1, authoredName: { ar: "مجانية", en: "Free" } }],
        credit: { availableUnits: 10, liabilityUnits: 0 },
        financials: { transactions: [], adjustments: [], executionHolds: [] },
      } }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    renderShell("ar");
    expect(await screen.findAllByText("مجانية")).toHaveLength(2);
    expect(screen.getByText("10 رصيدًا متاحًا")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ترقية الباقة" })).toBeInTheDocument();
    expect(screen.getByTestId("shell-commercial-status-compact")).toHaveAccessibleName("إدارة الباقة و10 رصيدًا متاحًا");
  });

  it("reads commercial state for the same authorized workspace selected by the switcher", async () => {
    window.localStorage.setItem("node-banana-active-workspace-id", "workspace-2");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) !== "/api/studio/billing") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ success: true, data: {
        subscription: null,
        plans: [{ planId: "free", version: 1, authoredName: { ar: "مجانية", en: "Free" } }],
        credit: { availableUnits: 7, liabilityUnits: 0 },
        financials: { transactions: [], adjustments: [], executionHolds: [] },
      } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderShell();
    expect(await screen.findByText("7 credits available")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/studio/billing", expect.objectContaining({ headers: { "x-workspace-id": "workspace-2" } }));
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

  it("opens the workspace switcher menu without losing its group context", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: /Noura Studio/ }));

    expect(await screen.findByRole("menuitem", { name: /Client Brand/ })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Toggle navigation" }).querySelector('[data-sidebar-icon-side="left"]')).toBeTruthy();
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
    expect(document.querySelector('[data-mobile="true"][data-side="right"]')).toHaveClass("data-[side=right]:right-0");
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
    expect(router.push).toHaveBeenCalledWith("/settings?section=account");
  });
});
