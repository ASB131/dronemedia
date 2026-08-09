import Link from "next/link";

import { cn } from "@/lib/utils";

export function SiteMark({
  href = "/",
  showLabel = true,
  className,
  size = "md",
  labelClassName,
}: {
  href?: string | null;
  showLabel?: boolean;
  className?: string;
  size?: "sm" | "md";
  labelClassName?: string;
}) {
  const iconClass = size === "sm" ? "size-8" : "size-9";
  const mark = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/icon.svg"
        alt=""
        className={cn(iconClass, "shrink-0 object-contain")}
      />
      {showLabel ? (
        <span
          className={cn(
            "font-semibold tracking-tight",
            size === "sm" ? "text-sm" : "hidden text-lg sm:inline",
            labelClassName,
          )}
        >
          Drone Media
        </span>
      ) : null}
    </>
  );

  if (!href) {
    return (
      <div className={cn("flex items-center gap-2.5", className)}>{mark}</div>
    );
  }

  return (
    <Link
      href={href}
      className={cn("flex items-center gap-2.5 font-semibold tracking-tight", className)}
    >
      {mark}
    </Link>
  );
}
