"use client";

import { create } from "zustand";

import {
  groupNotificationsByAsset,
  pruneFinishedNotifications,
} from "@/lib/notifications/group-by-asset";
import type { StoredNotification } from "@/lib/notifications/store";

type NotificationStore = {
  items: StoredNotification[];
  /** Live BullMQ waiting/active jobs — merged into the file-processing UI. */
  queueItems: StoredNotification[];
  unreadCount: number;
  connected: boolean;
  setConnected: (connected: boolean) => void;
  addNotification: (item: StoredNotification) => void;
  mergeNotifications: (items: StoredNotification[]) => void;
  setInitial: (items: StoredNotification[]) => void;
  setQueueItems: (items: StoredNotification[]) => void;
  markAsRead: () => void;
  /** Drop finished file cards; keep active processing. */
  dismissFinished: () => void;
};

function notificationKey(item: StoredNotification) {
  return `${item.timestamp}|${item.jobType}|${item.assetId ?? ""}|${item.status}`;
}

function mergedItems(
  items: StoredNotification[],
  queueItems: StoredNotification[],
) {
  return [...items, ...queueItems];
}

function countUnread(
  items: StoredNotification[],
  queueItems: StoredNotification[],
): number {
  const { groups, others } = groupNotificationsByAsset(
    mergedItems(items, queueItems),
  );
  return (
    groups.filter((group) => group.active).length +
    others.filter(
      (item) => item.status === "queued" || item.status === "processing",
    ).length
  );
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  items: [],
  queueItems: [],
  unreadCount: 0,
  connected: false,
  setConnected: (connected) => set({ connected }),
  addNotification: (item) =>
    set((state) => {
      const items = pruneFinishedNotifications(
        [item, ...state.items].slice(0, 500),
      );
      return {
        items,
        unreadCount: countUnread(items, state.queueItems),
      };
    }),
  mergeNotifications: (incoming) =>
    set((state) => {
      const existing = new Set(state.items.map(notificationKey));
      const fresh = incoming.filter(
        (item) => !existing.has(notificationKey(item)),
      );
      if (fresh.length === 0) return state;
      const items = pruneFinishedNotifications(
        [...fresh, ...state.items].slice(0, 500),
      );
      return {
        items,
        unreadCount: countUnread(items, state.queueItems),
      };
    }),
  setInitial: (items) =>
    set((state) => {
      const pruned = pruneFinishedNotifications(items.slice(0, 500));
      return {
        items: pruned,
        unreadCount: countUnread(pruned, state.queueItems),
      };
    }),
  setQueueItems: (queueItems) =>
    set((state) => {
      const items = pruneFinishedNotifications(state.items);
      return {
        items,
        queueItems,
        unreadCount: countUnread(items, queueItems),
      };
    }),
  markAsRead: () => set({ unreadCount: 0 }),
  dismissFinished: () =>
    set((state) => {
      const items = pruneFinishedNotifications(state.items);
      return {
        items,
        unreadCount: countUnread(items, state.queueItems),
      };
    }),
}));

export function jobTypeLabel(jobType: string): string {
  switch (jobType) {
    case "dedup":
      return "Checksum";
    case "thumbnails":
      return "Thumbnails";
    case "metadata":
      return "Metadata";
    case "srtFlightPath":
      return "Flight path";
    case "webTranscoding":
      return "Transcoding";
    case "panoramaStitch":
      return "Panorama stitch";
    case "serviceReminder":
      return "Service due";
    default:
      return jobType;
  }
}
