import Link from "next/link";

export default function AppNotFound() {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-lg font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        That route doesn’t exist or the media may have been moved.
      </p>
      <Link
        href="/"
        className="inline-flex h-8 items-center rounded-lg border border-border bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/80"
      >
        Back home
      </Link>
    </div>
  );
}