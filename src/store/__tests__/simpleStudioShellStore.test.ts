import { beforeEach, describe, expect, it } from "vitest";
import { useSimpleStudioShellStore } from "../simpleStudioShellStore";

describe("useSimpleStudioShellStore", () => {
  beforeEach(() => {
    // Reset store to initial state between tests
    useSimpleStudioShellStore.setState({
      savePromptDialogOpen: false,
      libraryModeFilter: "all",
      promptLibraryTab: "templates",
    });
  });

  describe("save prompt dialog", () => {
    it("initializes closed", () => {
      expect(useSimpleStudioShellStore.getState().savePromptDialogOpen).toBe(false);
    });

    it("openSavePromptDialog sets open to true", () => {
      useSimpleStudioShellStore.getState().openSavePromptDialog();
      expect(useSimpleStudioShellStore.getState().savePromptDialogOpen).toBe(true);
    });

    it("closeSavePromptDialog sets open to false", () => {
      useSimpleStudioShellStore.setState({ savePromptDialogOpen: true });
      useSimpleStudioShellStore.getState().closeSavePromptDialog();
      expect(useSimpleStudioShellStore.getState().savePromptDialogOpen).toBe(false);
    });
  });

  describe("library mode filter", () => {
    it("defaults to all", () => {
      expect(useSimpleStudioShellStore.getState().libraryModeFilter).toBe("all");
    });

    it("setLibraryModeFilter updates the filter", () => {
      useSimpleStudioShellStore.getState().setLibraryModeFilter("photo");
      expect(useSimpleStudioShellStore.getState().libraryModeFilter).toBe("photo");

      useSimpleStudioShellStore.getState().setLibraryModeFilter("video");
      expect(useSimpleStudioShellStore.getState().libraryModeFilter).toBe("video");

      useSimpleStudioShellStore.getState().setLibraryModeFilter("copy");
      expect(useSimpleStudioShellStore.getState().libraryModeFilter).toBe("copy");

      useSimpleStudioShellStore.getState().setLibraryModeFilter("all");
      expect(useSimpleStudioShellStore.getState().libraryModeFilter).toBe("all");
    });
  });

  describe("prompt library tab", () => {
    it("defaults to templates", () => {
      expect(useSimpleStudioShellStore.getState().promptLibraryTab).toBe("templates");
    });

    it("setPromptLibraryTab switches between templates and saved", () => {
      useSimpleStudioShellStore.getState().setPromptLibraryTab("saved");
      expect(useSimpleStudioShellStore.getState().promptLibraryTab).toBe("saved");

      useSimpleStudioShellStore.getState().setPromptLibraryTab("templates");
      expect(useSimpleStudioShellStore.getState().promptLibraryTab).toBe("templates");
    });
  });
});
