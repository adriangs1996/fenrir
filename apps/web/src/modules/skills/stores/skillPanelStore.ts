import type { ServerSkillDetails } from "@fenrir/contracts";
import { create } from "zustand";

export type SkillPanelView =
  | { kind: "list" }
  | { kind: "inspect"; skillName: string }
  | { kind: "create" }
  | { kind: "edit"; skillName: string };

export type SkillDetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; details: ServerSkillDetails }
  | { status: "error"; message: string };

interface SkillPanelState {
  view: SkillPanelView;
  searchQuery: string;
  activeTagFilter: string | null;
  detailStateBySkillName: Record<string, SkillDetailState>;

  setView: (view: SkillPanelView) => void;
  setSearchQuery: (query: string) => void;
  setActiveTagFilter: (tag: string | null) => void;
  openInspectView: (skillName: string) => void;
  markDetailLoading: (skillName: string) => void;
  setSkillDetails: (skillName: string, details: ServerSkillDetails) => void;
  setSkillDetailError: (skillName: string, message: string) => void;
  invalidateSkillDetails: (skillName: string) => void;
  /** Always returns to the list view. */
  goBack: () => void;
}

export const useSkillPanelStore = create<SkillPanelState>((set) => ({
  view: { kind: "list" },
  searchQuery: "",
  activeTagFilter: null,
  detailStateBySkillName: {},

  setView: (view) => set({ view }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setActiveTagFilter: (activeTagFilter) => set({ activeTagFilter }),
  openInspectView: (skillName) => set({ view: { kind: "inspect", skillName } }),
  markDetailLoading: (skillName) =>
    set((state) => ({
      detailStateBySkillName: {
        ...state.detailStateBySkillName,
        [skillName]: { status: "loading" },
      },
    })),
  setSkillDetails: (skillName, details) =>
    set((state) => ({
      detailStateBySkillName: {
        ...state.detailStateBySkillName,
        [skillName]: { status: "loaded", details },
      },
    })),
  setSkillDetailError: (skillName, message) =>
    set((state) => ({
      detailStateBySkillName: {
        ...state.detailStateBySkillName,
        [skillName]: { status: "error", message },
      },
    })),
  invalidateSkillDetails: (skillName) =>
    set((state) => ({
      detailStateBySkillName: {
        ...state.detailStateBySkillName,
        [skillName]: { status: "idle" },
      },
    })),
  goBack: () => set({ view: { kind: "list" } }),
}));
