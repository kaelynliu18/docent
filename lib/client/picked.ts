"use client";

import { create } from "zustand";

/** Photos chosen from the tab bar's + button, handed to /add without a second tap. */
export const usePicked = create<{ files: File[]; set: (f: File[]) => void; clear: () => void }>((set) => ({
  files: [],
  set: (files) => set({ files }),
  clear: () => set({ files: [] }),
}));
