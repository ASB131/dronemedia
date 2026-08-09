"use client";

import { useEffect, useState } from "react";
import { Copy, Plus, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

type InviteRow = {
  id: string;
  code: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  usedByUserId: string | null;
};

export function AdminInvitesPanel() {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const response = await fetch("/api/admin/invites");
    if (!response.ok) {
      setError("Failed to load invites");
      return;
    }
    const payload = (await response.json()) as { invites: InviteRow[] };
    setInvites(payload.invites);
  }

  useEffect(() => {
    let mounted = true;

    async function load() {
      const response = await fetch("/api/admin/invites");
      if (!response.ok) {
        if (mounted) setError("Failed to load invites");
        return;
      }
      const payload = (await response.json()) as { invites: InviteRow[] };
      if (mounted) setInvites(payload.invites);
    }

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  async function createInvite() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/admin/invites", { method: "POST" });
    setBusy(false);
    if (!response.ok) {
      setError("Failed to create invite");
      return;
    }
    await reload();
  }

  async function revokeInvite(inviteId: string) {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/admin/invites/${inviteId}`, {
      method: "PATCH",
    });
    setBusy(false);
    if (!response.ok) {
      setError("Failed to revoke invite");
      return;
    }
    await reload();
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Invite codes</h2>
        <Button size="sm" disabled={busy} onClick={() => void createInvite()}>
          <Plus className="size-4" />
          New invite
        </Button>
      </div>

      {error ? <p className="px-4 py-3 text-sm text-destructive">{error}</p> : null}

      {invites.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No invites yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <div>
                <p className="font-mono font-medium">{invite.code}</p>
                <p className="text-xs capitalize text-muted-foreground">
                  {invite.status}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void navigator.clipboard.writeText(invite.code)}
                >
                  <Copy className="size-4" />
                  Copy
                </Button>
                {invite.status === "active" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void revokeInvite(invite.id)}
                  >
                    <XCircle className="size-4" />
                    Revoke
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
