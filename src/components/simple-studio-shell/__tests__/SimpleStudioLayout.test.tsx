import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";

vi.mock("next/navigation", () => ({ usePathname: () => "/simple-studio/copy" }));
vi.mock("../useGenerateShortcut", () => ({ useGenerateShortcut: vi.fn() }));
vi.mock("../SimpleStudioSiteHeader", () => ({ SimpleStudioHeaderActions: () => null }));
vi.mock("../SavePromptDialog", () => ({ SavePromptDialog: () => null }));
vi.mock("@/components/product-shell/ProductShell", () => ({ ProductShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { SimpleStudioLayout } from "../SimpleStudioLayout";

const shellContext = {
  user: { name: "Alice", email: "alice@example.com", avatar: "" },
  workspaces: [{ id: "workspace-1", name: "Studio", slug: "studio", role: "owner" as const }],
  initialWorkspaceId: "workspace-1",
  canReadBilling: true,
  initialCommercialStatus: null,
};

describe("SimpleStudioLayout", () => {
  beforeEach(() => {
    useSimpleStudioStore.setState({
      outputLanguage: "en",
      dialogueLanguage: "en",
      loadRecentResults: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("hydrates Copy and Video authoring from the Workspace content-language default", async () => {
    render(<SimpleStudioLayout shellContext={shellContext} defaultContentLanguage="ar"><div>Studio</div></SimpleStudioLayout>);

    await waitFor(() => expect(useSimpleStudioStore.getState()).toMatchObject({
      mode: "copy",
      outputLanguage: "ar",
      dialogueLanguage: "ar",
    }));
  });
});
