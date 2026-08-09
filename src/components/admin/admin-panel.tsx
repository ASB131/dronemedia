"use client";

import { useState } from "react";

import { AdminBackupPanel } from "@/components/admin/admin-backup-panel";
import { AdminIntegrityPanel } from "@/components/admin/admin-integrity-panel";
import { AdminInvitesPanel } from "@/components/admin/admin-invites-panel";
import { AdminLutsPanel } from "@/components/admin/admin-luts-panel";
import {
  AdminAuditPanel,
  AdminCachePanel,
  AdminJobsPanel,
} from "@/components/admin/admin-ops-panels";
import { AdminSettingsPanel } from "@/components/admin/admin-settings-panel";
import { AdminUsersPanel } from "@/components/admin/admin-users-panel";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "users", label: "Users" },
  { id: "invites", label: "Invites" },
  { id: "luts", label: "LUTs" },
  { id: "settings", label: "Settings" },
  { id: "integrity", label: "Integrity" },
  { id: "cache", label: "Storage" },
  { id: "backup", label: "Backup" },
  { id: "audit", label: "Audit log" },
  { id: "jobs", label: "Failed jobs" },
] as const;

export function AdminPanel() {
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("users");

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Administration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage users, invites, settings, integrity, audit events, and failed
          jobs.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm",
              tab === entry.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "users" ? <AdminUsersPanel embedded /> : null}
      {tab === "invites" ? <AdminInvitesPanel /> : null}
      {tab === "luts" ? <AdminLutsPanel /> : null}
      {tab === "settings" ? <AdminSettingsPanel /> : null}
      {tab === "integrity" ? <AdminIntegrityPanel /> : null}
      {tab === "cache" ? <AdminCachePanel /> : null}
      {tab === "backup" ? <AdminBackupPanel /> : null}
      {tab === "audit" ? <AdminAuditPanel /> : null}
      {tab === "jobs" ? <AdminJobsPanel /> : null}
    </div>
  );
}
