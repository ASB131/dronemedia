"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AlbumMemberDto } from "@/lib/albums/queries";

type DirectoryUser = {
  id: string;
  username: string;
  displayName: string | null;
};

export function AlbumMembersPanel({
  albumId,
  canManage,
  members,
  onChanged,
}: {
  albumId: string;
  canManage: boolean;
  members: AlbumMemberDto[];
  onChanged: () => void;
}) {
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryLoading, setDirectoryLoading] = useState(false);

  useEffect(() => {
    const query = username.trim();
    if (!directoryOpen || !query) return;

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      const response = await fetch(
        `/api/users/directory?q=${encodeURIComponent(query)}&limit=8`,
      );
      const payload = (await response.json().catch(() => null)) as {
        users?: DirectoryUser[];
      } | null;
      if (!cancelled) {
        setDirectoryUsers(response.ok ? (payload?.users ?? []) : []);
        setDirectoryLoading(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [directoryOpen, username]);

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    if (!username.trim()) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/albums/${albumId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), role }),
    });
    setBusy(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setMessage(payload?.error ?? "Failed to add member");
      return;
    }
    setUsername("");
    setDirectoryOpen(false);
    setMessage("Member added");
    onChanged();
  }

  async function setMemberRole(userId: string, nextRole: "viewer" | "editor") {
    setMessage(null);
    const response = await fetch(`/api/albums/${albumId}/members`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role: nextRole }),
    });
    if (!response.ok) {
      setMessage("Failed to update role");
      return;
    }
    onChanged();
  }

  async function removeMember(userId: string) {
    setMessage(null);
    const response = await fetch(`/api/albums/${albumId}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!response.ok) {
      setMessage("Failed to remove member");
      return;
    }
    onChanged();
  }

  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Collaborators
      </h2>

      {canManage ? (
        <form
          onSubmit={(event) => void addMember(event)}
          className="flex flex-wrap items-end gap-2"
        >
          <div className="relative space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="member-user">
              Username
            </label>
            <Input
              id="member-user"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setDirectoryUsers([]);
                setDirectoryLoading(Boolean(event.target.value.trim()));
                setDirectoryOpen(true);
              }}
              onFocus={() => {
                setDirectoryLoading(Boolean(username.trim()));
                setDirectoryOpen(true);
              }}
              onBlur={() => {
                window.setTimeout(() => setDirectoryOpen(false), 150);
              }}
              placeholder="Search approved users"
              className="w-40"
              autoComplete="off"
            />
            {directoryOpen && username.trim() ? (
              <div
                role="listbox"
                className="absolute z-10 mt-1 w-64 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md"
              >
                {directoryLoading ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    Searching…
                  </p>
                ) : directoryUsers.length > 0 ? (
                  directoryUsers.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setUsername(user.username);
                        setDirectoryOpen(false);
                      }}
                    >
                      <span>{user.displayName?.trim() || user.username}</span>
                      <span className="text-xs text-muted-foreground">
                        @{user.username}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    No approved users found. You can still add an exact username.
                  </p>
                )}
              </div>
            ) : null}
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="member-role">
              Role
            </label>
            <select
              id="member-role"
              value={role}
              onChange={(event) =>
                setRole(event.target.value as "viewer" | "editor")
              }
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
          </div>
          <Button type="submit" disabled={busy} size="sm">
            Add
          </Button>
        </form>
      ) : null}

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No collaborators yet.</p>
      ) : (
        <ul className="space-y-2">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>
                {member.username}{" "}
                <span className="text-muted-foreground">({member.role})</span>
              </span>
              {canManage ? (
                <span className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void setMemberRole(
                        member.userId,
                        member.role === "editor" ? "viewer" : "editor",
                      )
                    }
                  >
                    Make {member.role === "editor" ? "viewer" : "editor"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void removeMember(member.userId)}
                  >
                    Remove
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}
    </section>
  );
}
