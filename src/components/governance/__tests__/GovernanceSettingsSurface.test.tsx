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
  listPublishingApprovals: vi.fn().mockResolvedValue([]),
  inspectPublishingApproval: vi.fn(),
  decidePublishingApproval: vi.fn(),
}));

const snapshot = {
  workspaceId: "workspace-a",
  actorCapabilities: ["governance.view", "members.invite", "members.manage", "roles.manage", "portfolios.manage", "reviews.create", "reviews.decide_content", "reviews.decide_publishing", "approval_policies.manage", "audit.view", "audit.export", "regions.manage", "retention.manage", "safety.decide", "safety.appeal", "bulk.preview", "bulk.execute", "imports.manage", "exports.manage", "workspace.transfer_ownership", "workspace.close"],
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
    expect(screen.getAllByText("Reviewer")).not.toHaveLength(0);
    expect(screen.getByText("Version 2")).toBeInTheDocument();
    expect(screen.getAllByText("reviews.decide_publishing")).not.toHaveLength(0);
  });

  it("creates an authored Arabic invitation with an exact built-in role", async () => {
    const user = userEvent.setup();
    renderSurface("members", "ar");
    expect(await screen.findByRole("heading", { name: "الأعضاء والدعوات" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("البريد الإلكتروني"), "reviewer@example.com");
    await user.click(screen.getByRole("button", { name: /إرسال دعوة موثقة/ }));
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
    await user.type(screen.getByLabelText("Target IDs"), "content-1\ncontent-2");
    await user.click(screen.getByRole("button", { name: /Preview Bulk Operation/ }));
    await waitFor(() => expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: "preview_bulk", concurrency: 3, items: [{ targetWorkspaceId: "workspace-a", targetKind: "resource", targetId: "content-1" }, { targetWorkspaceId: "workspace-a", targetKind: "resource", targetId: "content-2" }] })));
  });

  it("renders permission-gated workflows instead of executable controls", async () => {
    getSnapshot.mockResolvedValue({ ...snapshot, actorCapabilities: ["governance.view"], resources: {} });
    renderSurface("data");
    expect(await screen.findAllByText("Your current Workspace authority does not include this workflow.")).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Activate verified region" })).not.toBeInTheDocument();
  });

  it("offers all Approval Policy decision modes in Arabic", async () => {
    const user = userEvent.setup();
    renderSurface("approval", "ar");
    const mode = await screen.findByLabelText("نمط القرار");
    await user.selectOptions(mode, "quorum");
    expect(screen.getByLabelText("عدد الموافقات المطلوبة")).toBeInTheDocument();
    expect(screen.getByText("مراحل متسلسلة")).toBeInTheDocument();
  });

  it("uses a signed package workflow for every canonical portable surface", async () => {
    renderSurface("portability");
    expect(await screen.findByLabelText("Verify and preview a signed import")).toHaveAttribute("type", "file");
    for (const label of ["Workspace media", "Content revisions", "Saved prompts", "Brand sources", "Calendar plans", "Platform export metadata"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText("Canonical JSON payload")).not.toBeInTheDocument();
  });
});
