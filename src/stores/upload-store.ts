import { create } from "zustand";

import type { UploadBatchState, UploadFileState } from "@/lib/upload/client";

type UploadStore = {
  batch: UploadBatchState;
  setBatch: (batch: UploadBatchState) => void;
  updateFile: (localId: string, patch: Partial<UploadFileState>) => void;
  reset: () => void;
};

const initialBatch: UploadBatchState = {
  files: [],
  status: "idle",
};

export const useUploadStore = create<UploadStore>((set) => ({
  batch: initialBatch,
  setBatch: (batch) => set({ batch }),
  updateFile: (localId, patch) =>
    set((state) => ({
      batch: {
        ...state.batch,
        files: state.batch.files.map((file) =>
          file.localId === localId ? { ...file, ...patch } : file,
        ),
      },
    })),
  reset: () => set({ batch: initialBatch }),
}));
