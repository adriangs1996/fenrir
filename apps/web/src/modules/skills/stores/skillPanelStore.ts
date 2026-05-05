import { create } from "zustand";

export type SkillPanelView =
  | { kind: "list" }
  | { kind: "inspect"; skillName: string }
  | { kind: "create" }
  | { kind: "edit"; skillName: string };

interface SkillPanelState {
  view: SkillPanelView;
  searchQuery: string;
  activeTagFilter: string | null;

  setView: (view: SkillPanelView) => void;
  setSearchQuery: (query: string) => void;
  setActiveTagFilter: (tag: string | null) => void;
  /** Always returns to the list view. */
  goBack: () => void;
}

export const useSkillPanelStore = create<SkillPanelState>((set) => ({
  view: { kind: "list" },
  searchQuery: "",
  activeTagFilter: null,

  setView: (view) => set({ view }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setActiveTagFilter: (activeTagFilter) => set({ activeTagFilter }),
  goBack: () => set({ view: { kind: "list" } }),
}));
