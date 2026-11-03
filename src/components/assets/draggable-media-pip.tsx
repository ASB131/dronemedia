"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

type PipLayout = {
  x: number;
  y: number;
  width: number;
};

const MIN_WIDTH = 240;
const MAX_WIDTH_RATIO = 0.92;
const DEFAULT_WIDTH = 380;

function readLayout(storageKey: string): PipLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PipLayout;
    if (
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y) &&
      Number.isFinite(parsed.width)
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function DraggableMediaPip({
  storageKey,
  label = "Media",
  className,
  children,
}: {
  storageKey: string;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const layoutRef = useRef<PipLayout | null>(null);
  const [layout, setLayout] = useState<PipLayout>(() => {
    const saved = readLayout(storageKey);
    return (
      saved ?? {
        x: 16,
        y: 72,
        width: DEFAULT_WIDTH,
      }
    );
  });

  layoutRef.current = layout;

  const persist = useCallback(
    (next: PipLayout) => {
      setLayout(next);
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    },
    [storageKey],
  );

  useEffect(() => {
    const parent = containerRef.current?.offsetParent as HTMLElement | null;
    if (!parent) return;
    const maxW = Math.min(
      parent.clientWidth * MAX_WIDTH_RATIO,
      Math.max(MIN_WIDTH, layout.width),
    );
    if (layout.width > maxW) {
      persist({ ...layout, width: maxW });
    }
  }, [layout, persist]);

  function clampPosition(x: number, y: number, width: number) {
    const parent = containerRef.current?.offsetParent as HTMLElement | null;
    if (!parent) return { x, y };
    const maxX = Math.max(0, parent.clientWidth - width - 8);
    const maxY = Math.max(0, parent.clientHeight - 160);
    return {
      x: Math.min(Math.max(8, x), maxX),
      y: Math.min(Math.max(8, y), maxY),
    };
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute z-30 flex flex-col overflow-hidden rounded-xl border border-white/15 bg-black/90 shadow-2xl ring-1 ring-white/10",
        className,
      )}
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.width,
      }}
    >
      <div
        className="flex cursor-grab items-center justify-between border-b border-white/10 px-2 py-1 active:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          dragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            originX: layout.x,
            originY: layout.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          const dx = event.clientX - dragRef.current.startX;
          const dy = event.clientY - dragRef.current.startY;
          const next = clampPosition(
            dragRef.current.originX + dx,
            dragRef.current.originY + dy,
            layout.width,
          );
          setLayout((prev) => ({ ...prev, ...next }));
        }}
        onPointerUp={(event) => {
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          if (layoutRef.current) persist(layoutRef.current);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          if (layoutRef.current) persist(layoutRef.current);
        }}
      >
        <p className="text-[10px] font-medium uppercase tracking-wide text-white/60">
          {label}
        </p>
        <span className="text-[10px] text-white/40">Drag · resize corner</span>
      </div>
      <div className="relative aspect-video w-full bg-black">{children}</div>
      <div
        className="absolute bottom-0 right-0 size-4 cursor-nwse-resize"
        aria-hidden
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          resizeRef.current = {
            startX: event.clientX,
            startWidth: layout.width,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.stopPropagation();
        }}
        onPointerMove={(event) => {
          if (!resizeRef.current) return;
          const parent = containerRef.current?.offsetParent as HTMLElement | null;
          const maxW = parent
            ? parent.clientWidth * MAX_WIDTH_RATIO
            : 640;
          const nextW = Math.min(
            maxW,
            Math.max(MIN_WIDTH, resizeRef.current.startWidth + (event.clientX - resizeRef.current.startX)),
          );
          setLayout((prev) => {
            const clamped = clampPosition(prev.x, prev.y, nextW);
            return { ...prev, width: nextW, ...clamped };
          });
        }}
        onPointerUp={(event) => {
          resizeRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          if (layoutRef.current) persist(layoutRef.current);
        }}
      />
    </div>
  );
}
