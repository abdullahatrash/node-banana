import type { ComponentProps, ReactNode } from "react"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NavUser } from "../nav-user"
import { SidebarProvider } from "@/components/ui/sidebar"
import { I18nTestProvider } from "@/test/i18n"
import { useDirectionStore } from "@/store/directionStore"

const router = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}))

vi.mock("@/lib/auth/client", () => ({
  authClient: { signOut: vi.fn() },
}))

vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SidebarMenuButton: () => null,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
  SidebarProvider: ({ children }: { children: ReactNode }) => children,
  useSidebar: () => ({ isMobile: false }),
}))

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  DropdownMenuItem: ({ children, onClick, onSelect, ...props }: ComponentProps<"button"> & { onSelect?: () => void }) => (
    <button type="button" role="menuitem" onClick={onClick ?? onSelect} {...props}>{children}</button>
  ),
}))

function renderNavUser() {
  return render(
    <I18nTestProvider locale="en">
      <SidebarProvider>
        <NavUser user={{ name: "Noura Alnajjar", email: "noura@example.com", avatar: "" }} />
      </SidebarProvider>
    </I18nTestProvider>,
  )
}

async function selectArabic() {
  const user = userEvent.setup()
  await user.click(screen.getByRole("menuitem", { name: "العربية" }))
}

describe("NavUser locale switch", () => {
  afterEach(() => vi.unstubAllGlobals())

  beforeEach(() => {
    vi.clearAllMocks()
    useDirectionStore.setState({ locale: "en", direction: "ltr" })
    document.documentElement.lang = "en"
    document.documentElement.dir = "ltr"
    window.localStorage.clear()
  })

  it("waits for the durable preference before refreshing", async () => {
    let resolvePreference!: (response: Response) => void
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolvePreference = resolve })))
    window.localStorage.setItem("node-banana-active-workspace-id", "workspace-a")
    renderNavUser()

    await selectArabic()

    expect(document.documentElement).toHaveAttribute("lang", "ar")
    expect(document.documentElement).toHaveAttribute("dir", "rtl")
    expect(screen.getByRole("menuitem", { name: "العربية" })).toBeDisabled()
    expect(screen.getByRole("menuitem", { name: "العربية" })).toHaveAttribute("aria-busy", "true")
    expect(fetch).toHaveBeenCalledWith("/api/preferences/locale", expect.objectContaining({
      body: JSON.stringify({ locale: "ar" }),
      headers: expect.objectContaining({ "x-workspace-id": "workspace-a" }),
    }))
    expect(router.refresh).not.toHaveBeenCalled()

    await act(async () => resolvePreference(new Response(null, { status: 204 })))
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalledOnce())
  })

  it("restores the current direction when preference persistence fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })))
    renderNavUser()

    await selectArabic()

    await vi.waitFor(() => expect(document.documentElement).toHaveAttribute("dir", "ltr"))
    expect(document.documentElement).toHaveAttribute("lang", "en")
    expect(router.refresh).not.toHaveBeenCalled()
  })
})
