"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AdminUser = {
  id: string;
  username: string;
  email: string;
  role: "admin" | "user";
  approvalStatus: "pending" | "approved" | "rejected";
  storageUsedBytes: number;
  storageQuotaBytes: number;
  allowInAppSource?: boolean | null;
  createdAt: string;
};

const GB = 1024 ** 3;

function formatBytes(bytes: number) {
  const gb = bytes / GB;
  return `${gb.toFixed(2)} GB`;
}

export function AdminUsersPanel({ embedded = false }: { embedded?: boolean }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [quotaDrafts, setQuotaDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;

    async function loadUsers() {
      const response = await fetch("/api/admin/users");
      if (!response.ok) {
        if (mounted) setError("Failed to load users");
        return;
      }
      const payload = (await response.json()) as { users: AdminUser[] };
      if (mounted) {
        setUsers(payload.users);
        setQuotaDrafts(
          Object.fromEntries(
            payload.users.map((user) => [
              user.id,
              (user.storageQuotaBytes / GB).toFixed(2),
            ]),
          ),
        );
      }
    }

    void loadUsers();

    return () => {
      mounted = false;
    };
  }, []);

  async function reloadUsers() {
    const response = await fetch("/api/admin/users");
    if (!response.ok) {
      setError("Failed to load users");
      return;
    }
    const payload = (await response.json()) as { users: AdminUser[] };
    setUsers(payload.users);
    setQuotaDrafts(
      Object.fromEntries(
        payload.users.map((user) => [
          user.id,
          (user.storageQuotaBytes / GB).toFixed(2),
        ]),
      ),
    );
  }

  async function updateUser(
    userId: string,
    approvalStatus: "approved" | "rejected",
    asDisable = false,
  ) {
    setBusyId(userId);
    setError(null);
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalStatus, asDisable }),
    });
    setBusyId(null);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(payload?.error ?? "Failed to update user");
      return;
    }
    await reloadUsers();
  }

  async function saveQuota(userId: string) {
    const draft = quotaDrafts[userId];
    const gb = Number(draft);
    if (!Number.isFinite(gb) || gb <= 0) {
      setError("Quota must be a positive number of GB");
      return;
    }
    const storageQuotaBytes = Math.round(gb * GB);
    setBusyId(userId);
    setError(null);
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageQuotaBytes }),
    });
    setBusyId(null);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(payload?.error ?? "Failed to update quota");
      return;
    }
    await reloadUsers();
  }

  async function saveSourcePref(
    userId: string,
    value: "inherit" | "allow" | "deny",
  ) {
    const allowInAppSource =
      value === "inherit" ? null : value === "allow";
    setBusyId(userId);
    setError(null);
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowInAppSource }),
    });
    setBusyId(null);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(payload?.error ?? "Failed to update Source setting");
      return;
    }
    await reloadUsers();
  }

  async function disableUser(userId: string) {
    await updateUser(userId, "rejected", true);
  }

  async function deleteUser(userId: string) {
    if (!window.confirm("Delete this user and all of their data?")) return;
    setBusyId(userId);
    setError(null);
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "DELETE",
    });
    setBusyId(null);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(payload?.error ?? "Failed to delete user");
      return;
    }
    await reloadUsers();
  }

  const pending = users.filter((user) => user.approvalStatus === "pending");

  return (
    <div className={embedded ? "space-y-6" : "mx-auto max-w-4xl space-y-6 p-6"}>
      {!embedded ? (
        <div>
          <h1 className="text-xl font-semibold">Administration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage user approvals and monitor storage usage.
          </p>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            Pending approval ({pending.length})
          </h2>
        </div>
        {pending.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No users waiting for approval.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((user) => (
              <li
                key={user.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="font-medium">{user.username}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busyId === user.id}
                    onClick={() => void updateUser(user.id, "approved")}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === user.id}
                    onClick={() => void updateUser(user.id, "rejected")}
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">All users ({users.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Storage</th>
                <th className="px-4 py-2 font-medium">Quota (GB)</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-border/60">
                  <td className="px-4 py-3">
                    <p className="font-medium">{user.username}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </td>
                  <td className="px-4 py-3 capitalize">{user.role}</td>
                  <td className="px-4 py-3 capitalize">{user.approvalStatus}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatBytes(user.storageUsedBytes)} /{" "}
                    {formatBytes(user.storageQuotaBytes)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={0.01}
                        step={0.01}
                        value={quotaDrafts[user.id] ?? ""}
                        onChange={(event) =>
                          setQuotaDrafts((prev) => ({
                            ...prev,
                            [user.id]: event.target.value,
                          }))
                        }
                        className="h-8 w-24 text-sm"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === user.id}
                        onClick={() => void saveQuota(user.id)}
                      >
                        Save
                      </Button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {user.role === "admin" ? (
                      <span className="text-xs text-muted-foreground">
                        Always on
                      </span>
                    ) : (
                      <select
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                        disabled={busyId === user.id}
                        value={
                          user.allowInAppSource === true
                            ? "allow"
                            : user.allowInAppSource === false
                              ? "deny"
                              : "inherit"
                        }
                        onChange={(event) =>
                          void saveSourcePref(
                            user.id,
                            event.target.value as "inherit" | "allow" | "deny",
                          )
                        }
                      >
                        <option value="inherit">Inherit</option>
                        <option value="allow">Allow</option>
                        <option value="deny">Deny</option>
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {user.role !== "admin" &&
                      user.approvalStatus === "approved" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === user.id}
                          onClick={() => void disableUser(user.id)}
                        >
                          Disable
                        </Button>
                      ) : null}
                      {user.role !== "admin" &&
                      user.approvalStatus === "rejected" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === user.id}
                          onClick={() => void updateUser(user.id, "approved")}
                        >
                          Enable
                        </Button>
                      ) : null}
                      {user.role !== "admin" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === user.id}
                          onClick={() => void deleteUser(user.id)}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
