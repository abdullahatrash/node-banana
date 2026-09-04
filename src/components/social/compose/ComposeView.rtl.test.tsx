import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nTestProvider } from "@/test/i18n";
import { useSocialComposerStore } from "@/store/socialComposerStore";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ show: vi.fn() }),
}));
vi.mock("./PlatformSelector", () => ({ PlatformSelector: () => null }));
vi.mock("./PublishingSettingsPanels", () => ({ PublishingSettingsPanels: () => null }));
vi.mock("./PostEditor", () => ({ PostEditor: () => <textarea aria-label="content" dir="auto" /> }));
vi.mock("./MediaAttachments", () => ({ MediaAttachments: () => null }));
vi.mock("./MediaPool", () => ({ MediaPool: () => null }));
vi.mock("./SchedulePicker", () => ({ SchedulePicker: () => null }));
vi.mock("./PreviewPanel", () => ({ PreviewPanel: () => null }));

import { ComposeView } from "./ComposeView";

describe("ComposeView RTL behavior", () => {
  beforeEach(() => {
    useSocialComposerStore.getState().reset();
  });

  it("localizes the heading, mirrors Back, and keeps mixed content automatic", () => {
    const { container } = render(
      <I18nTestProvider locale="ar">
        <ComposeView />
      </I18nTestProvider>,
    );

    expect(screen.getByText("منشور جديد")).toBeInTheDocument();
    const back = screen.getByRole("button", { name: "رجوع" });
    expect(back.querySelector("svg")).toHaveClass("rtl:rotate-180");
    expect(screen.getByLabelText("content")).toHaveAttribute("dir", "auto");
    expect(container.querySelector(".flex-wrap.border-t")).toBeInTheDocument();
  });
});
