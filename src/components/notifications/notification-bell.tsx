"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  MinusCircle,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  groupNotificationsByAsset,
  type AssetJobGroup,
  type StepStatus,
} from "@/lib/notifications/group-by-asset";
import type { StoredNotification } from "@/lib/notifications/store";
import {
  jobTypeLabel,
  useNotificationStore,
} from "@/stores/notification-store";
import { cn } from "@/lib/utils";

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "complete") {
    return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />;
  }
  if (status === "failed") {
    return <XCircle className="size-3.5 shrink-0 text-destructive" />;
  }
  if (status === "processing") {
    return (
      <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
    );
  }
  if (status === "queued") {
    return <Circle className="size-3.5 shrink-0 text-amber-500" />;
  }
  if (status === "skipped") {
    return <MinusCircle className="size-3.5 shrink-0 text-muted-foreground/40" />;
  }
  return <Circle className="size-3.5 shrink-0 text-muted-foreground/40" />;
}

function stepLabel(status: StepStatus) {
  if (status === "pending") return "Waiting";
  if (status === "skipped") return "Skipped";
  if (status === "queued") return "Queued";
  if (status === "processing") return "Running";
  if (status === "complete") return "Done";
  if (status === "failed") return "Failed";
  return status;
}

function currentStepSummary(group: AssetJobGroup) {
  const running = group.steps.find((step) => step.status === "processing");
  if (running) return jobTypeLabel(running.jobType);
  const queued = group.steps.find((step) => step.status === "queued");
  if (queued) return `Queued · ${jobTypeLabel(queued.jobType)}`;
  const pending = group.steps.find((step) => step.status === "pending");
  if (pending) return `Waiting · ${jobTypeLabel(pending.jobType)}`;
  if (group.overall === "failed") return "Failed";
  return "Processing";
}

function isActivelyRunning(group: AssetJobGroup) {
  return group.steps.some((step) => step.status === "processing");
}

const HISTORY_POLL_MS = 15_000;
const QUEUE_POLL_MS = 4_000;

function AssetCard({ group }: { group: AssetJobGroup }) {
  const [stagesOpen, setStagesOpen] = useState(false);
  const running = isActivelyRunning(group);
  const failedMessage = group.steps.find(
    (step) => step.message && step.status === "failed",
  )?.message;

  return (
    <div className="rounded-lg border border-border/70 bg-background">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={stagesOpen}
        onClick={() => setStagesOpen((value) => !value)}
      >
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <Circle className="size-3.5 shrink-0 text-amber-500" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{group.assetName}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {currentStepSummary(group)}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            stagesOpen && "rotate-180",
          )}
        />
      </button>

      {stagesOpen ? (
        <div className="border-t border-border/60 px-3 pb-2.5 pt-2">
          <ol className="space-y-0.5">
            {group.steps.map((step) => (
              <li
                key={step.jobType}
                className={cn(
                  "flex items-center gap-2 rounded-md px-1 py-1 text-xs",
                  step.status === "processing" && "bg-primary/5",
                  step.status === "failed" && "bg-destructive/5",
                )}
              >
                <StepIcon status={step.status} />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    step.status === "pending" || step.status === "skipped"
                      ? "text-muted-foreground"
                      : "font-medium text-foreground",
                  )}
                >
                  {jobTypeLabel(step.jobType)}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[11px]",
                    step.status === "failed"
                      ? "text-destructive"
                      : step.status === "complete"
                        ? "text-emerald-600"
                        : "text-muted-foreground",
                  )}
                >
                  {stepLabel(step.status)}
                </span>
              </li>
            ))}
          </ol>
          {failedMessage ? (
            <p className="mt-1.5 line-clamp-2 text-[11px] text-destructive">
              {failedMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastSinceRef = useRef<string | undefined>(undefined);
  const {
    items,
    queueItems,
    unreadCount,
    connected,
    setConnected,
    addNotification,
    mergeNotifications,
    setInitial,
    setQueueItems,
    markAsRead,
    dismissFinished,
  } = useNotificationStore();

  const { groups, others } = useMemo(
    () => groupNotificationsByAsset([...items, ...queueItems]),
    [items, queueItems],
  );

  // Only in-flight work — never show completed history.
  const activeGroups = useMemo(
    () => groups.filter((group) => group.active),
    [groups],
  );
  const working = useMemo(
    () => activeGroups.filter((group) => isActivelyRunning(group)),
    [activeGroups],
  );
  const upNext = useMemo(
    () => activeGroups.filter((group) => !isActivelyRunning(group)),
    [activeGroups],
  );
  const activeOthers = useMemo(
    () =>
      others.filter(
        (item) => item.status === "queued" || item.status === "processing",
      ),
    [others],
  );

  useEffect(() => {
    // Drop finished cards from local history as the live queue advances.
    dismissFinished();
  }, [queueItems, dismissFinished]);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/account");
      if (!response.ok) return;
      const payload = (await response.json()) as {
        preferences?: { notificationsEnabled?: boolean };
      };
      setEnabled(payload.preferences?.notificationsEnabled !== false);
    })();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    let historyTimer: ReturnType<typeof setInterval> | undefined;
    let queueTimer: ReturnType<typeof setInterval> | undefined;
    let source: EventSource | null = null;

    function updateSince(timestamp: string) {
      if (
        !lastSinceRef.current ||
        Date.parse(timestamp) > Date.parse(lastSinceRef.current)
      ) {
        lastSinceRef.current = timestamp;
      }
    }

    async function pollNotifications(full = false) {
      const since = full ? undefined : lastSinceRef.current;
      const url = since
        ? `/api/notifications?since=${encodeURIComponent(since)}`
        : "/api/notifications";
      const response = await fetch(url);
      if (!response.ok || !mounted) return;

      const payload = (await response.json()) as {
        notifications: StoredNotification[];
        queueNotifications?: StoredNotification[];
      };

      if (since) {
        mergeNotifications(payload.notifications);
      } else {
        setInitial(payload.notifications);
      }
      setQueueItems(payload.queueNotifications ?? []);

      for (const item of payload.notifications) {
        updateSince(item.timestamp);
      }
    }

    async function pollQueueOnly() {
      const response = await fetch("/api/notifications?queueOnly=1");
      if (!response.ok || !mounted) return;
      const payload = (await response.json()) as {
        queueNotifications?: StoredNotification[];
      };
      setQueueItems(payload.queueNotifications ?? []);
    }

    function connectStream() {
      source?.close();
      source = new EventSource("/api/notifications/stream");

      source.onopen = () => {
        setConnected(true);
      };
      source.onerror = () => {
        setConnected(false);
      };
      source.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as StoredNotification & {
            type?: string;
          };
          if (parsed.type === "heartbeat" || parsed.type === "connected") return;
          addNotification(parsed);
          updateSince(parsed.timestamp);
        } catch {
          // ignore malformed events
        }
      };
    }

    void pollNotifications(true).then(() => {
      if (!mounted) return;
      connectStream();
      queueTimer = setInterval(() => void pollQueueOnly(), QUEUE_POLL_MS);
      historyTimer = setInterval(
        () => void pollNotifications(false),
        HISTORY_POLL_MS,
      );
    });

    return () => {
      mounted = false;
      if (historyTimer) clearInterval(historyTimer);
      if (queueTimer) clearInterval(queueTimer);
      source?.close();
      setConnected(false);
    };
  }, [
    enabled,
    addNotification,
    mergeNotifications,
    setConnected,
    setInitial,
    setQueueItems,
  ]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) {
        if (open) {
          setOpen(false);
          dismissFinished();
        }
      }
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, dismissFinished]);

  if (!enabled) {
    return null;
  }

  const empty = activeGroups.length === 0 && activeOthers.length === 0;
  const totalActive = activeGroups.length + activeOthers.length;

  return (
    <div className="relative" ref={panelRef}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Notifications"
        className="size-10 rounded-full text-foreground"
        onClick={() => {
          setOpen((value) => {
            const next = !value;
            if (next) {
              markAsRead();
            } else {
              dismissFinished();
            }
            return next;
          });
        }}
      >
        <Bell className="size-5" />
        {totalActive > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
            {totalActive > 9 ? "9+" : totalActive}
          </span>
        ) : unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div className="absolute right-0 top-10 z-50 w-[22rem] rounded-xl border border-border bg-popover p-2 shadow-lg">
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <div>
              <p className="text-sm font-medium">Processing</p>
              <p className="text-[11px] text-muted-foreground">
                {totalActive > 0
                  ? `${working.length} running · ${upNext.length} queued`
                  : "Queue empty"}
              </p>
            </div>
            <p className="shrink-0 text-[11px] text-muted-foreground">
              {connected ? "Live" : "…"}
            </p>
          </div>

          <div className="max-h-[26rem] space-y-1.5 overflow-auto px-0.5 pb-1">
            {empty ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                Nothing in the queue
              </p>
            ) : null}

            {working.map((group) => (
              <AssetCard key={group.assetId} group={group} />
            ))}
            {upNext.map((group) => (
              <AssetCard key={group.assetId} group={group} />
            ))}

            {activeOthers.map((item, index) => (
              <div
                key={`${item.timestamp}-${item.jobType}-${index}`}
                className="rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
              >
                <p className="font-medium">{jobTypeLabel(item.jobType)}</p>
                <p className="text-[11px] capitalize text-muted-foreground">
                  {item.status}
                  {item.message ? ` · ${item.message}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
