import { create } from "zustand";

export type ReviewCommandId =
  | "review.previousItem"
  | "review.nextItem"
  | "review.openChange"
  | "review.askAgent"
  | "review.markReviewed"
  | "review.markNeedsFollowUp"
  | "review.toggleMode"
  | "review.refreshAnalysis"
  | "review.openSubmitReviewTray";

export interface ReviewCommandRegistration {
  readonly availableCommands: ReadonlySet<ReviewCommandId>;
  readonly runCommand: (command: ReviewCommandId) => Promise<void>;
}

interface ReviewCommandStoreState {
  readonly registration: ReviewCommandRegistration | null;
  readonly setRegistration: (registration: ReviewCommandRegistration | null) => void;
}

export const useReviewCommandStore = create<ReviewCommandStoreState>((set) => ({
  registration: null,
  setRegistration: (registration) => set({ registration }),
}));

export function readReviewCommandRegistration(): ReviewCommandRegistration | null {
  return useReviewCommandStore.getState().registration;
}
