import { create } from "zustand";

export type LibraryModeFilter = "all" | "photo" | "video" | "copy";
export type PromptLibraryTab = "templates" | "saved";

interface SimpleStudioShellState {
  // Save prompt dialog
  savePromptDialogOpen: boolean;
  openSavePromptDialog: () => void;
  closeSavePromptDialog: () => void;

  // Library filter
  libraryModeFilter: LibraryModeFilter;
  setLibraryModeFilter: (mode: LibraryModeFilter) => void;

  // Prompt library active tab
  promptLibraryTab: PromptLibraryTab;
  setPromptLibraryTab: (tab: PromptLibraryTab) => void;
}

export const useSimpleStudioShellStore = create<SimpleStudioShellState>((set) => ({
  savePromptDialogOpen: false,
  openSavePromptDialog: () => set({ savePromptDialogOpen: true }),
  closeSavePromptDialog: () => set({ savePromptDialogOpen: false }),

  libraryModeFilter: "all",
  setLibraryModeFilter: (mode) => set({ libraryModeFilter: mode }),

  promptLibraryTab: "templates",
  setPromptLibraryTab: (tab) => set({ promptLibraryTab: tab }),
}));
