import { render as testingRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, beforeEach } from "vitest";
import { LibraryGallery } from "../LibraryGallery";
import { useSimpleStudioStore, type Generation } from "@/store/simpleStudioStore";
import { useSimpleStudioShellStore } from "@/store/simpleStudioShellStore";
import messages from "@/i18n/messages/en.json";
import messagesAr from "@/i18n/messages/ar.json";

function render(ui: ReactElement) {
  return testingRender(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

function renderArabic(ui: ReactElement) {
  return testingRender(
    <NextIntlClientProvider locale="ar" messages={messagesAr} timeZone="UTC">
      <div dir="rtl">{ui}</div>
    </NextIntlClientProvider>,
  );
}

function makeGen(overrides: Partial<Generation>): Generation {
  return {
    id: "g1",
    batchId: "b1",
    status: "complete",
    result: "data:image/png;base64,xxx",
    assetId: null,
    error: null,
    mode: "photo",
    aspectRatio: "1:1",
    prompt: "A cat",
    createdAt: Date.now(),
    modelName: "Auto",
    ...overrides,
  };
}

describe("LibraryGallery", () => {
  beforeEach(() => {
    useSimpleStudioStore.setState({
      generationsByMode: {
        photo: [makeGen({ id: "p1", mode: "photo", prompt: "Photo one" })],
        video: [makeGen({ id: "v1", mode: "video", prompt: "Video one", result: "data:video/mp4;base64,xxx" })],
        copy: [makeGen({ id: "c1", mode: "copy", prompt: "Copy one", result: "Text output" })],
      },
      generations: [],
      mode: "photo",
    });
    useSimpleStudioShellStore.setState({ libraryModeFilter: "all" });
  });

  it("renders all generations when filter is 'all'", () => {
    render(<LibraryGallery />);
    expect(screen.getByText("Photo one")).toBeInTheDocument();
    expect(screen.getByText("Video one")).toBeInTheDocument();
    expect(screen.getByText("Copy one")).toBeInTheDocument();
  });

  it("renders only photo generations when filter is 'photo'", () => {
    useSimpleStudioShellStore.setState({ libraryModeFilter: "photo" });
    render(<LibraryGallery />);
    expect(screen.getByText("Photo one")).toBeInTheDocument();
    expect(screen.queryByText("Video one")).not.toBeInTheDocument();
    expect(screen.queryByText("Copy one")).not.toBeInTheDocument();
  });

  it("renders only video generations when filter is 'video'", () => {
    useSimpleStudioShellStore.setState({ libraryModeFilter: "video" });
    render(<LibraryGallery />);
    expect(screen.queryByText("Photo one")).not.toBeInTheDocument();
    expect(screen.getByText("Video one")).toBeInTheDocument();
    expect(screen.queryByText("Copy one")).not.toBeInTheDocument();
  });

  it("renders only copy generations when filter is 'copy'", () => {
    useSimpleStudioShellStore.setState({ libraryModeFilter: "copy" });
    render(<LibraryGallery />);
    expect(screen.queryByText("Photo one")).not.toBeInTheDocument();
    expect(screen.queryByText("Video one")).not.toBeInTheDocument();
    expect(screen.getByText("Copy one")).toBeInTheDocument();
  });

  it("renders an empty state when there are no generations", () => {
    useSimpleStudioStore.setState({
      generationsByMode: { photo: [], video: [], copy: [] },
      generations: [],
    });
    render(<LibraryGallery />);
    expect(screen.getByText(/no generations yet/i)).toBeInTheDocument();
  });

  it("auto-detects mixed prompt and copy directions under Arabic UI", () => {
    useSimpleStudioStore.setState({
      generationsByMode: {
        photo: [makeGen({ id: "p1", mode: "photo", prompt: "Photo صورة launch" })],
        video: [makeGen({ id: "v1", mode: "video", prompt: "Video فيديو launch" })],
        copy: [makeGen({ id: "c1", mode: "copy", prompt: "Copy نص launch", result: "Result نتيجة ready" })],
      },
    });

    renderArabic(<LibraryGallery />);

    for (const text of ["Photo صورة launch", "Video فيديو launch", "Copy نص launch", "Result نتيجة ready"]) {
      expect(screen.getByText(text)).toHaveAttribute("dir", "auto");
    }
    expect(screen.getByAltText("Photo صورة launch")).toHaveAttribute("dir", "auto");
  });
});
