"use client";

import { useEffect, useState } from "react";

import {
  lutColorProfileLabel,
  type LutColorProfile,
} from "@/lib/luts/color-profile";
import { cn } from "@/lib/utils";

type LutOption = {
  id: string;
  name: string;
  colorProfile: LutColorProfile;
};

export function PreviewLutPicker({
  colorProfile,
  value,
  onChange,
  className,
  compact = false,
}: {
  colorProfile: LutColorProfile;
  value: string | null;
  onChange: (lutId: string | null) => void;
  className?: string;
  compact?: boolean;
}) {
  const [options, setOptions] = useState<LutOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(
        `/api/luts?colorProfile=${encodeURIComponent(colorProfile)}`,
      );
      if (!response.ok || cancelled) return;
      const payload = (await response.json()) as { luts: LutOption[] };
      if (!cancelled) setOptions(payload.luts);
    })();
    return () => {
      cancelled = true;
    };
  }, [colorProfile]);

  return (
    <label
      className={cn(
        "flex min-w-0 items-center gap-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="shrink-0">
        {compact ? "LUT" : `Preview LUT (${lutColorProfileLabel(colorProfile)})`}
      </span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
      >
        <option value="">None</option>
        {options.map((lut) => (
          <option key={lut.id} value={lut.id}>
            {lut.name}
          </option>
        ))}
      </select>
    </label>
  );
}
