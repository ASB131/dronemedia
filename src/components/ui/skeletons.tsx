import { cn } from "@/lib/utils";

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("dm-skeleton rounded-md bg-muted", className)} />;
}

export function MediaGridSkeleton({
  count = 24,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-3 gap-1 p-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8",
        className,
      )}
      aria-hidden
    >
      {Array.from({ length: count }, (_, index) => (
        <SkeletonBlock key={index} className="aspect-square rounded-md" />
      ))}
    </div>
  );
}

export function DetailChromeSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex h-full flex-col bg-background", className)}
      aria-busy
      aria-label="Loading"
    >
      <div className="flex h-14 items-center gap-2 border-b border-border px-3 sm:px-4">
        <SkeletonBlock className="size-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonBlock className="h-4 w-48 max-w-[60%]" />
          <SkeletonBlock className="h-3 w-28 max-w-[40%]" />
        </div>
        <SkeletonBlock className="size-10 shrink-0 rounded-full" />
        <SkeletonBlock className="size-10 shrink-0 rounded-full" />
        <SkeletonBlock className="size-10 shrink-0 rounded-full" />
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_380px]">
        <SkeletonBlock className="min-h-[50vh] rounded-none lg:min-h-0" />
        <div className="hidden space-y-3 border-l border-border p-4 lg:block">
          <SkeletonBlock className="h-5 w-32" />
          <SkeletonBlock className="h-20 w-full" />
          <SkeletonBlock className="h-5 w-24" />
          <SkeletonBlock className="h-32 w-full" />
          <SkeletonBlock className="h-5 w-28" />
          <SkeletonBlock className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}

export function MapShellSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("dm-skeleton size-full min-h-64 rounded-none bg-muted", className)}
      aria-busy
      aria-label="Loading map"
    />
  );
}
