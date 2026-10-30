"use client";

import { Film, Images, ImageIcon, Link2 } from "lucide-react";

import { formatUploadBytes } from "@/lib/upload/client";
import type { UploadGroupPreview } from "@/lib/upload/preview-groups";
import { cn } from "@/lib/utils";

function kindIcon(kind: UploadGroupPreview["kind"]) {
  if (kind === "clip") return Film;
  if (kind === "hyperlapse" || kind === "panorama") return Images;
  return ImageIcon;
}

function kindLabel(kind: UploadGroupPreview["kind"]) {
  switch (kind) {
    case "clip":
      return "One video asset";
    case "hyperlapse":
      return "Hyperlapse sequence";
    case "panorama":
      return "Panorama sequence";
    case "sidecar":
      return "Sidecar only";
    default:
      return "Photo";
  }
}

export function UploadGroupPreviewList({
  groups,
  className,
}: {
  groups: UploadGroupPreview[];
  className?: string;
}) {
  if (groups.length === 0) return null;

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border border-border bg-muted/20 p-4",
        className,
      )}
    >
      <div>
        <p className="text-sm font-medium">Import preview</p>
        <p className="text-xs text-muted-foreground">
          {groups.length} library asset{groups.length === 1 ? "" : "s"} from{" "}
          {groups.reduce((sum, group) => sum + group.files.length, 0)} file
          {groups.reduce((sum, group) => sum + group.files.length, 0) === 1
            ? ""
            : "s"}
          . Linked SRT/LRF stay with their clip.
        </p>
      </div>
      <ul className="max-h-56 space-y-2 overflow-auto dm-scrollbar">
        {groups.map((group) => {
          const Icon = kindIcon(group.kind);
          return (
            <li
              key={group.id}
              className="rounded-lg border border-border/80 bg-background px-3 py-2.5"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{group.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {kindLabel(group.kind)}
                    {group.files.length > 1
                      ? ` · ${group.files.length} files`
                      : ""}
                    {" · "}
                    {formatUploadBytes(group.totalBytes)}
                  </p>
                  {group.linked.length > 0 ? (
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary">
                      <Link2 className="size-3" />
                      Includes {group.linked.join(", ")}
                    </p>
                  ) : null}
                  <p className="mt-1 truncate text-[10px] text-muted-foreground/80">
                    {group.files.slice(0, 4).join(" · ")}
                    {group.files.length > 4
                      ? ` · +${group.files.length - 4} more`
                      : ""}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
