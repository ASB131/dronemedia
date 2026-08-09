"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Globe2, LogOut, Settings, User } from "lucide-react";

import { signOutAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";

export function ProfileMenu({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        title={username}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-10 items-center justify-center rounded-full hover:bg-muted"
      >
        <User className="size-5" />
      </button>
      {open ? (
        <div className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-medium">{username}</p>
            <p className="text-xs text-muted-foreground">Account</p>
          </div>
          <div className="p-1.5">
            <Link
              href={`/u/${encodeURIComponent(username)}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-muted"
            >
              <Globe2 className="size-4 text-muted-foreground" />
              Public profile
            </Link>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-muted"
            >
              <Settings className="size-4 text-muted-foreground" />
              Account settings
            </Link>
            <form action={signOutAction}>
              <Button
                type="submit"
                variant="ghost"
                className="h-auto w-full justify-start rounded-xl px-3 py-2 text-sm font-normal"
              >
                <LogOut className="size-4 text-muted-foreground" />
                Sign out
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
