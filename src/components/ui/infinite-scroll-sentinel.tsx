"use client";

import { useEffect, useRef } from "react";

function getScrollParent(el: HTMLElement | null): Element | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const style = getComputedStyle(node);
    const overflowY = style.overflowY;
    if (
      overflowY === "auto" ||
      overflowY === "scroll" ||
      overflowY === "overlay"
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Invisible sentinel that triggers `onLoadMore` when scrolled near the viewport.
 * Place after a media grid; keeps pagination seamless without a Load more click.
 */
export function InfiniteScrollSentinel({
  enabled,
  loading,
  onLoadMore,
  rootMargin = "480px",
}: {
  enabled: boolean;
  loading: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    if (!enabled || loading) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const root = getScrollParent(el);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMoreRef.current();
        }
      },
      { root, rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, loading, rootMargin]);

  if (!enabled && !loading) return null;

  return (
    <div
      ref={ref}
      className="flex justify-center py-4"
      aria-hidden={!loading}
    >
      {loading ? (
        <span className="text-xs text-muted-foreground">Loading more…</span>
      ) : (
        <span className="h-1 w-1" />
      )}
    </div>
  );
}
