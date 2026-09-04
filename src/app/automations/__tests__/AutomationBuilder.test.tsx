import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationBuilder } from "../AutomationBuilder";
import type { CampaignAuthoringOptions } from "@/lib/product-surfaces/campaign-authoring";

const productRequest = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => values ? `${key}:${Object.values(values).join(":")}` : key,
  useFormatter: () => ({ dateTime: () => "Sep 4" }),
}));
vi.mock("@/components/product-surfaces/ProductApi", () => ({
  productRequest: (...args: unknown[]) => productRequest(...args),
  ProductRequestError: class ProductRequestError extends Error { constructor(readonly code: string) { super(code); } },
}));

const digest = `sha256:${"a".repeat(64)}`;
const options: CampaignAuthoringOptions = {
  brand: { id: "brand-1", revision: 4, digest, label: "Brand" },
  inspirations: [{ id: "inspiration-1", label: "Reference", detail: "v2" }],
  personas: [{ id: "persona-1", label: "Presenter", detail: "v3" }],
  demoAssets: [{ id: "asset-1", label: "Demo", detail: "video" }],
  mediaSets: [{ id: "set-1", label: "Products", detail: "v2" }],
  themes: [{ id: "theme-1:2", themeId: "theme-1", revision: 2, digest, label: "Licensed", detail: "v2" }],
  channels: [{ id: "channel-1", label: "TikTok", detail: "tiktok" }],
  workflows: [{ id: "workflow-revision-1", workflowId: "workflow-1", revisionId: "workflow-revision-1", revision: 2, definitionDigest: digest, label: "Publish", detail: "v2", inputs: [{ name: "brief", kind: "text", required: true }, { name: "source", kind: "image", required: false }] }],
  modelPolicies: [{ id: "workspace-default", label: "Workspace default", detail: null }],
  grants: [{ id: "grant-1", label: "Grant", detail: "channel-1", channelId: "channel-1", expiresAt: null }],
};
const calendarPreferences = { contentMarket: "EG" as const, timezone: "Africa/Cairo", weekStartsOn: 6 as const };

describe("AutomationBuilder", () => {
  beforeEach(() => { productRequest.mockReset(); replace.mockReset(); refresh.mockReset(); });

  it("keeps a new Automation provisional until the first substantive save", async () => {
    productRequest.mockResolvedValue({ record: { id: "campaign-1", title: "Launch", state: "draft", revision: 1, payload: {} } });
    render(<AutomationBuilder automations={[]} occurrences={[]} options={options} calendarPreferences={calendarPreferences} selectedAutomationId={null} />);

    expect(screen.getByText("provisional")).toBeVisible();
    const stepButtons = screen.getAllByRole("button", { name: /steps\./ });
    expect(stepButtons).toHaveLength(10);
    expect(stepButtons[1]).toBeDisabled();
    expect(productRequest).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText("fields.name"));
    await userEvent.type(screen.getByLabelText("fields.name"), "Launch");
    await userEvent.click(screen.getByRole("button", { name: /saveContinue/ }));

    await waitFor(() => expect(productRequest).toHaveBeenCalledWith("/api/product-campaigns", expect.objectContaining({
      action: "save_draft",
      title: "Launch",
      payload: expect.objectContaining({ currentStep: 2, contentLanguage: "ar", arabicVariety: "msa", reviewMode: "request_human", cadence: expect.objectContaining({ timezone: "Africa/Cairo", weekStart: 6 }) }),
    })));
    expect(replace).toHaveBeenCalledWith("/automations/campaign-1/edit");
  });

  it("renders canonical selectors instead of caller-authored identifier lists", () => {
    const payload = {
      currentStep: 8, name: "Launch", formatMix: { slideshow: 100 }, remixRatio: 50, inspirationIds: [],
      brandProfileRef: { id: "brand-1", revision: 4, digest }, contentLanguage: "ar", arabicVariety: "msa",
      personaIds: [], demoAssetIds: [], mediaSetIds: [], themeRevisionRefs: [], channelIds: [], variantsPerChannel: 1,
      cadence: { timezone: "Asia/Riyadh", weekStart: 0, startAt: null, endAt: null, postsPerWeek: 3, calendarCapacity: 20 },
      execution: { mode: "managed", modelPolicy: "workspace-default", creditCeiling: 20, budgetCents: 5000, replenishmentMode: "manual", blitzTargetCapacity: 20, blitzMaximumCreatesPerRun: 10, workflow: null },
      reviewMode: "request_human", autoPublishGrantId: null, validationErrors: [], runtime: null,
    };
    render(<AutomationBuilder automations={[{ id: "campaign-1", title: "Launch", state: "draft", revision: 3, payload }]} occurrences={[]} options={options} calendarPreferences={calendarPreferences} selectedAutomationId="campaign-1" />);

    expect(screen.getByLabelText("fields.workflowRevisionId")).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByRole("option", { name: /Publish/ })).toHaveValue("workflow-revision-1");
    expect(screen.queryByRole("textbox", { name: /Workflow ID|Artifact IDs|JSON/i })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Grant/i })).toBeNull();
  });
});
