import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { GovernanceSettingsSurface } from "../GovernanceSettingsSurface";

const getSnapshot = vi.fn();
const execute = vi.fn();

vi.mock("@/lib/governance/client", () => ({
  GovernanceApiError: class GovernanceApiError extends Error {
    constructor(readonly code: string, readonly status: number) { super(code); }
  },
  getGovernanceSnapshot: () => getSnapshot(),
  executeGovernanceCommand: (command: unknown) => execute(command),
}));

const snapshot = {
  workspaceId: "workspace-a",
  actorCapabilities: ["governance.view", "roles.manage", "audit.view"],
  resources: {
    custom_role: [{ id: "role-1", workspaceId: "workspace-a", kind: "custom_role", version: 2, status: "active", body: { activeRevision: 2, name: "Reviewer" }, createdByUserId: "owner", createdAt: new Date("2026-09-03T00:00:00.000Z"), updatedAt: new Date("2026-09-03T00:00:00.000Z") }],
  },
  audit: [{ schema: "workspace-audit-event/v1", id: "audit-1", workspaceId: "workspace-a", sequence: 1, actor: { kind: "human", id: "owner" }, capability: "roles.manage@1", action: "create_custom_role", resource: { kind: "custom_role", id: "role-1" }, outcome: "completed", redactedDetails: {}, occurredAt: new Date("2026-09-03T00:00:00.000Z") }],
};

function renderSurface(section: Parameters<typeof GovernanceSettingsSurface>[0]["section"], locale: "ar" | "en" = "en") {
  return render(<I18nTestProvider locale={locale}><GovernanceSettingsSurface section={section} /></I18nTestProvider>);
}

describe("GovernanceSettingsSurface", () => {
  beforeEach(() => {
    getSnapshot.mockReset().mockResolvedValue(snapshot);
    execute.mockReset().mockResolvedValue({});
  });

  it("renders a live versioned role catalog and Custom Role form", async () => {
    renderSurface("roles");
    expect(await screen.findByRole("heading", { name: "Workspace Roles" })).toBeInTheDocument();
    expect(screen.getByText("Built-in capability bundles")).toBeInTheDocument();
    expect(screen.getByText("Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Version 2")).toBeInTheDocument();
    expect(screen.getByText("reviews.decide_publishing")).toBeInTheDocument();
  });

  it("creates an authored Arabic invitation with an exact built-in role", async () => {
    const user = userEvent.setup();
    renderSurface("members", "ar");
    expect(await screen.findByRole("heading", { name: "الأعضاء والدعوات" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("البريد الإلكتروني"), "reviewer@example.com");
    await user.click(screen.getByRole("button", { name: /إنشاء دعوة موثقة/ }));
    await waitFor(() => expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: "create_invitation", email: "reviewer@example.com", binding: { kind: "built_in", role: "creator" } })));
  });

  it("shows append-only audit evidence without exposing hidden payloads", async () => {
    renderSurface("audit");
    expect(await screen.findByRole("heading", { name: "Workspace Audit Trail" })).toBeInTheDocument();
    expect(screen.getByText("create_custom_role")).toBeInTheDocument();
    expect(screen.getByText("roles.manage@1")).toHaveAttribute("dir", "ltr");
    expect(screen.queryByText(/tokenDigest/)).not.toBeInTheDocument();
  });

  it("builds a bounded dry-run against the exact current Workspace", async () => {
    const user = userEvent.setup();
    renderSurface("bulk");
    await screen.findByRole("heading", { name: "Bulk operations" });
    await user.type(screen.getByLabelText("Exact capability"), "content.archive@1");
    await user.type(screen.getByLabelText("Target IDs separated by spaces"), "content-1 content-2");
    await user.click(screen.getByRole("button", { name: /Preview Bulk Operation/ }));
    await waitFor(() => expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: "preview_bulk", concurrency: 3, items: [{ targetWorkspaceId: "workspace-a", targetKind: "resource", targetId: "content-1" }, { targetWorkspaceId: "workspace-a", targetKind: "resource", targetId: "content-2" }] })));
  });
});
