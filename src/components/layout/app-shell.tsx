"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CloudUpload, Menu, X } from "lucide-react";

import { signOutAction } from "@/actions/auth";
import { SiteMark } from "@/components/brand/site-mark";
import { AppNav } from "@/components/layout/app-nav";
import { ProfileMenu } from "@/components/layout/profile-menu";
import { SearchBar } from "@/components/search/search-bar";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { UploadDock } from "@/components/upload/upload-dock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "1.0.0";
const PIN_SESSION_KEY = "dm-pin-unlocked";

export type AppShellUser = {
  username: string;
  role: "admin" | "user";
};

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  const gib = bytes / 1024 ** 3;
  if (gib >= 1024) {
    return `${(gib / 1024).toFixed(1)} TiB`;
  }
  if (gib >= 1) {
    return `${gib.toFixed(1)} GiB`;
  }
  const mib = bytes / 1024 ** 2;
  if (mib >= 1) {
    return `${mib.toFixed(1)} MiB`;
  }
  const units = ["B", "KB", "MB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function applyTheme(theme: "light" | "dark" | "system") {
  const root = document.documentElement;
  root.classList.add("theme-changing");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  try {
    localStorage.setItem("dm-theme", theme);
  } catch {
    // ignore
  }
  window.setTimeout(() => root.classList.remove("theme-changing"), 50);
}

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: AppShellUser;
}) {
  const pathname = usePathname();
  const cinemaMode = pathname === "/cinema";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [usedBytes, setUsedBytes] = useState<number | null>(null);
  const [quotaBytes, setQuotaBytes] = useState<number | null>(null);
  const [diskUsedBytes, setDiskUsedBytes] = useState<number | null>(null);
  const [diskTotalBytes, setDiskTotalBytes] = useState<number | null>(null);
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pinUnlocked, setPinUnlocked] = useState(true);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  useEffect(() => {
    async function loadAccount() {
      const response = await fetch("/api/account");
      if (!response.ok) return;
      const payload = (await response.json()) as {
        usedBytes: number;
        quotaBytes: number;
        diskUsedBytes?: number | null;
        diskTotalBytes?: number | null;
        pinEnabled: boolean;
        preferences: {
          theme: "light" | "dark" | "system";
          downloadOriginalDefault: boolean;
        };
      };
      setUsedBytes(payload.usedBytes);
      setQuotaBytes(payload.quotaBytes);
      setDiskUsedBytes(payload.diskUsedBytes ?? null);
      setDiskTotalBytes(payload.diskTotalBytes ?? null);
      setPinEnabled(payload.pinEnabled);
      applyTheme(payload.preferences.theme);
      if (payload.pinEnabled) {
        setPinUnlocked(sessionStorage.getItem(PIN_SESSION_KEY) === "1");
      } else {
        setPinUnlocked(true);
      }

      const versionRes = await fetch("/api/version");
      if (versionRes.ok) {
        const version = (await versionRes.json()) as {
          updateAvailable?: boolean;
        };
        setUpdateAvailable(Boolean(version.updateAvailable));
      }
    }

    void loadAccount();

    const onPrefs = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { theme?: "light" | "dark" | "system" }
        | undefined;
      if (detail?.theme) applyTheme(detail.theme);
    };
    const onPinChanged = () => {
      void loadAccount();
    };
    const refreshStorage = async () => {
      const response = await fetch("/api/account");
      if (!response.ok) return;
      const payload = (await response.json()) as {
        usedBytes: number;
        quotaBytes: number;
        diskUsedBytes?: number | null;
        diskTotalBytes?: number | null;
      };
      setUsedBytes(payload.usedBytes);
      setQuotaBytes(payload.quotaBytes);
      setDiskUsedBytes(payload.diskUsedBytes ?? null);
      setDiskTotalBytes(payload.diskTotalBytes ?? null);
    };

    window.addEventListener("dm-preferences", onPrefs);
    window.addEventListener("dm-pin-changed", onPinChanged);
    window.addEventListener("dm-storage-changed", refreshStorage);
    window.addEventListener("focus", refreshStorage);
    return () => {
      window.removeEventListener("dm-preferences", onPrefs);
      window.removeEventListener("dm-pin-changed", onPinChanged);
      window.removeEventListener("dm-storage-changed", refreshStorage);
      window.removeEventListener("focus", refreshStorage);
    };
  }, []);

  async function unlockPin(event: React.FormEvent) {
    event.preventDefault();
    setPinError(null);
    const response = await fetch("/api/account/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unlock", pin: pinInput }),
    });
    if (!response.ok) {
      setPinError("Incorrect PIN");
      return;
    }
    sessionStorage.setItem(PIN_SESSION_KEY, "1");
    setPinUnlocked(true);
    setPinInput("");
  }

  const footerUsed =
    diskUsedBytes != null && diskTotalBytes != null
      ? diskUsedBytes
      : usedBytes;
  const footerTotal =
    diskUsedBytes != null && diskTotalBytes != null
      ? diskTotalBytes
      : quotaBytes;
  const usedPct =
    footerUsed != null && footerTotal != null && footerTotal > 0
      ? Math.min(100, (footerUsed / footerTotal) * 100)
      : 0;

  if (pinEnabled && !pinUnlocked) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background p-6">
        <form
          onSubmit={(event) => void unlockPin(event)}
          className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm"
        >
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Unlock Drone Media
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your app lock PIN to continue as {user.username}.
            </p>
          </div>
          <Input
            type="password"
            inputMode="numeric"
            autoFocus
            placeholder="PIN"
            value={pinInput}
            onChange={(event) => setPinInput(event.target.value)}
            required
          />
          {pinError ? (
            <p className="text-sm text-destructive">{pinError}</p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" className="flex-1">
              Unlock
            </Button>
            <Button type="submit" formAction={signOutAction} variant="outline">
              Sign out
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <ServiceWorkerRegister />
      {cinemaMode ? (
        <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {children}
        </main>
      ) : (
        <>
      <header className="grid h-[var(--navbar-height)] shrink-0 grid-cols-[auto_minmax(0,1fr)] border-b border-black/10 dark:border-white/20 md:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="flex items-center gap-2 px-3 sm:px-5">
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Toggle sidebar"
            className="md:hidden"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? <X className="size-6" /> : <Menu className="size-6" />}
          </Button>
          <SiteMark href="/" />
        </div>

        <div className="flex min-w-0 items-center gap-3 px-3 sm:px-4">
          <div className="min-w-0 flex-1">
            <SearchBar />
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Link
              href="/upload"
              aria-label="Upload"
              className="inline-flex h-11 items-center gap-2 rounded-full px-2 text-sm font-medium text-foreground hover:bg-muted sm:px-3"
            >
              <CloudUpload className="size-5" />
              <span className="hidden sm:inline">Upload</span>
            </Link>
            <NotificationBell />
            <ProfileMenu username={user.username} />
          </div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {mobileNavOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        ) : null}

        <aside
          className={cn(
            "z-40 flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-transform duration-200 md:static md:w-[17rem] md:translate-x-0",
            "absolute inset-y-0 left-0 md:relative",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          )}
        >
          <div
            className="flex min-h-0 flex-1 flex-col"
            onClick={() => setMobileNavOpen(false)}
          >
            <AppNav showAdmin={user.role === "admin"} />
          </div>
          <footer className="space-y-3 p-4">
            <div className="rounded-xl bg-muted/80 px-3 py-3 dark:bg-[#1a1a1a]">
              <p className="text-sm font-semibold text-foreground">
                Storage space
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {footerUsed != null && footerTotal != null
                  ? `${formatBytes(footerUsed)} of ${formatBytes(footerTotal)} used`
                  : "Loading…"}
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-700/40 dark:bg-neutral-700">
                <div
                  className="h-full rounded-full bg-[#acccfa]"
                  style={{ width: `${usedPct}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between px-1 text-sm">
              <span className="inline-flex items-center gap-2 text-foreground">
                <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
                Server Online
              </span>
              <span className="text-xs text-muted-foreground">
                v{APP_VERSION}
                {updateAvailable ? " · update" : ""}
              </span>
            </div>
          </footer>
        </aside>

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="dm-content-enter dm-scrollbar h-full min-h-0 overflow-auto">
            {children}
          </div>
        </main>
      </div>
      <UploadDock />
        </>
      )}
    </div>
  );
}
