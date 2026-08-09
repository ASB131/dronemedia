"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Globe2,
  HardDrive,
  MonitorSmartphone,
  Palette,
  Shield,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "preferences", label: "Preferences", icon: Palette },
  { id: "security", label: "Security", icon: Shield },
] as const;

type TabId = (typeof tabs)[number]["id"];

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

type AccountPayload = {
  usedBytes: number;
  quotaBytes: number;
  username: string;
  email: string;
  role: string;
  displayName: string | null;
  profileUrl: string;
  pinEnabled: boolean;
  preferences: {
    theme: "light" | "dark" | "system";
    downloadOriginalDefault: boolean;
    zipMultiSelectDefault: boolean;
    notificationsEnabled: boolean;
    defaultPlaybackResolution: "1080" | "1440" | "source";
    previewLutId: string | null;
  };
};

type DeviceRow = {
  id: string;
  revoked: boolean;
  createdAt: string;
  lastActiveAt: string;
  deviceInfo: Record<string, unknown>;
};

function PrefToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3 hover:bg-muted/30">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        className="mt-1 size-4 accent-[var(--primary)]"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function AccountSettingsView() {
  const [tab, setTab] = useState<TabId>("profile");
  const [account, setAccount] = useState<AccountPayload | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [pin, setPin] = useState("");
  const [pinPassword, setPinPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  async function reloadDevices() {
    const devicesRes = await fetch("/api/account/security?view=devices");
    if (devicesRes.ok) {
      const payload = (await devicesRes.json()) as { devices: DeviceRow[] };
      setDevices(payload.devices);
    }
  }

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/account");
      if (!response.ok) {
        setError("Failed to load account");
        return;
      }
      const payload = (await response.json()) as AccountPayload & {
        bio?: string | null;
      };
      setAccount(payload);
      setDisplayName(payload.displayName ?? "");
      await reloadDevices();
    })();
  }, []);

  async function saveProfile() {
    setSavingProfile(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim() || null,
        }),
      });
      if (!response.ok) {
        setError("Failed to save profile");
        return;
      }
      const payload = (await response.json()) as {
        displayName: string | null;
      };
      setAccount((current) =>
        current
          ? {
              ...current,
              displayName: payload.displayName,
            }
          : current,
      );
      setMessage("Profile saved");
    } finally {
      setSavingProfile(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("tab");
    if (
      fromQuery === "profile" ||
      fromQuery === "preferences" ||
      fromQuery === "security"
    ) {
      setTab(fromQuery);
    }
  }, []);

  function selectTab(next: TabId) {
    setTab(next);
    setMessage(null);
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState({}, "", url.toString());
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    const response = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(payload?.error ?? "Failed to change password");
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setMessage("Password updated");
  }

  async function savePreferences(
    patch: Partial<AccountPayload["preferences"]>,
  ) {
    if (!account) return;
    setMessage(null);
    setError(null);
    const response = await fetch("/api/account/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      setError("Failed to save preferences");
      return;
    }
    setAccount({
      ...account,
      preferences: { ...account.preferences, ...patch },
    });
    setMessage("Preferences saved");
  }

  async function setOrClearPin(action: "set" | "clear") {
    setMessage(null);
    setError(null);
    const response = await fetch("/api/account/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "set"
          ? { action, pin, currentPassword: pinPassword }
          : { action, currentPassword: pinPassword },
      ),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(payload?.error ?? "PIN update failed");
      return;
    }
    const payload = (await response.json()) as { pinEnabled: boolean };
    if (account) setAccount({ ...account, pinEnabled: payload.pinEnabled });
    setPin("");
    setPinPassword("");
    setMessage(payload.pinEnabled ? "PIN enabled" : "PIN cleared");
    sessionStorage.removeItem("dm-pin-unlocked");
    window.dispatchEvent(new Event("dm-pin-changed"));
  }

  if (!account && !error) {
    return (
      <div className="p-8 text-sm text-muted-foreground">Loading settings…</div>
    );
  }

  const usedPct =
    account && account.quotaBytes > 0
      ? Math.min(100, (account.usedBytes / account.quotaBytes) * 100)
      : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Account, preferences, and security
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => selectTab(entry.id)}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition",
                  tab === entry.id
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {entry.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {error ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {message}
            </p>
          ) : null}

          {tab === "profile" && account ? (
            <div className="space-y-4">
              <section className="rounded-2xl border border-border bg-card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Account
                </p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-muted/40 px-3 py-2.5">
                    <dt className="text-xs text-muted-foreground">Username</dt>
                    <dd className="mt-0.5 truncate text-sm font-medium">
                      {account.username}
                    </dd>
                  </div>
                  <div className="rounded-xl bg-muted/40 px-3 py-2.5">
                    <dt className="text-xs text-muted-foreground">Email</dt>
                    <dd className="mt-0.5 truncate text-sm font-medium">
                      {account.email}
                    </dd>
                  </div>
                  <div className="rounded-xl bg-muted/40 px-3 py-2.5">
                    <dt className="text-xs text-muted-foreground">Role</dt>
                    <dd className="mt-0.5 text-sm font-medium capitalize">
                      {account.role}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Globe2 className="size-4 text-muted-foreground" />
                      <p className="text-sm font-semibold">Public profile</p>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Display name on Community for media you mark as Public
                    </p>
                  </div>
                  <Link
                    href={account.profileUrl}
                    className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted"
                  >
                    View profile
                  </Link>
                </div>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Display name
                    </label>
                    <Input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder={account.username}
                      className="mt-1"
                      maxLength={80}
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={savingProfile}
                    onClick={() => void saveProfile()}
                  >
                    Save profile
                  </Button>
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-2">
                  <HardDrive className="size-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">Storage</p>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${usedPct}%` }}
                  />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {formatBytes(account.usedBytes)} of{" "}
                  {formatBytes(account.quotaBytes)} used ({usedPct.toFixed(1)}%)
                </p>
              </section>
            </div>
          ) : null}

          {tab === "preferences" && account ? (
            <div className="space-y-4">
              <section className="rounded-2xl border border-border bg-card p-4">
                <p className="text-sm font-semibold">Theme</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Choose how Drone Media looks on this device
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(
                    [
                      ["system", "System"],
                      ["light", "Light"],
                      ["dark", "Dark"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => void savePreferences({ theme: value })}
                      className={cn(
                        "h-10 rounded-xl border text-sm font-medium transition",
                        account.preferences.theme === value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-muted/40",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-card p-4">
                <p className="text-sm font-semibold">Default playback quality</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Starting resolution for videos. Source plays the original
                  camera file in the browser.
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(
                    [
                      ["1080", "1080"],
                      ["1440", "1440"],
                      ["source", "Source"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        void savePreferences({
                          defaultPlaybackResolution: value,
                        })
                      }
                      className={cn(
                        "h-10 rounded-xl border text-sm font-medium transition",
                        (account.preferences.defaultPlaybackResolution ??
                          "1080") === value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-muted/40",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <PrefToggle
                  label="Download originals by default"
                  description="Prefer full-resolution files when downloading media"
                  checked={account.preferences.downloadOriginalDefault}
                  onChange={(checked) =>
                    void savePreferences({ downloadOriginalDefault: checked })
                  }
                />
                <PrefToggle
                  label="Zip multi-select downloads"
                  description="Package multiple selected items into a zip automatically"
                  checked={account.preferences.zipMultiSelectDefault}
                  onChange={(checked) =>
                    void savePreferences({ zipMultiSelectDefault: checked })
                  }
                />
                <PrefToggle
                  label="Job notifications"
                  description="Show processing updates for uploads, thumbnails, and transcodes"
                  checked={account.preferences.notificationsEnabled}
                  onChange={(checked) =>
                    void savePreferences({ notificationsEnabled: checked })
                  }
                />
              </section>
            </div>
          ) : null}

          {tab === "security" ? (
            <div className="space-y-4">
              <section className="rounded-2xl border border-border bg-card p-4">
                <p className="text-sm font-semibold">Password</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Update the password used to sign in
                </p>
                <form
                  onSubmit={(event) => void changePassword(event)}
                  className="mt-3 space-y-2"
                >
                  <Input
                    type="password"
                    placeholder="Current password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    required
                  />
                  <Input
                    type="password"
                    placeholder="New password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    required
                  />
                  <Button type="submit" size="sm">
                    Update password
                  </Button>
                </form>
              </section>

              <section className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">App lock PIN</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Optional 4–8 digit PIN required once per browser session
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-medium",
                      account?.pinEnabled
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {account?.pinEnabled ? "Enabled" : "Off"}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  <Input
                    type="password"
                    inputMode="numeric"
                    placeholder="PIN (4–8 digits)"
                    value={pin}
                    onChange={(event) => setPin(event.target.value)}
                  />
                  <Input
                    type="password"
                    placeholder="Account password"
                    value={pinPassword}
                    onChange={(event) => setPinPassword(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      type="button"
                      onClick={() => void setOrClearPin("set")}
                    >
                      {account?.pinEnabled ? "Update PIN" : "Enable PIN"}
                    </Button>
                    {account?.pinEnabled ? (
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() => void setOrClearPin("clear")}
                      >
                        Clear PIN
                      </Button>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-2">
                  <MonitorSmartphone className="size-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">Authorised devices</p>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Active browser sessions for this account
                </p>
                <ul className="mt-3 space-y-2">
                  {devices.map((device) => (
                    <li
                      key={device.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          Session {device.id.slice(0, 8)}
                          {device.revoked ? (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              revoked
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Last active{" "}
                          {new Date(device.lastActiveAt).toLocaleString()}
                        </p>
                      </div>
                      {!device.revoked ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void (async () => {
                              await fetch("/api/account/security", {
                                method: "DELETE",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  type: "device",
                                  id: device.id,
                                }),
                              });
                              await reloadDevices();
                              setMessage("Device revoked");
                            })()
                          }
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </li>
                  ))}
                  {devices.length === 0 ? (
                    <li className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                      No sessions recorded
                    </li>
                  ) : null}
                </ul>
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
