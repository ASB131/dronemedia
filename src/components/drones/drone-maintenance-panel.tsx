"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type MaintenanceLog = {
  id: string;
  serviceDate: string;
  description: string;
  notes: string | null;
  flightHoursAtService: number | null;
  reminderThresholdHours: number | null;
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(iso),
  );
}

export function DroneMaintenancePanel({ droneId }: { droneId: string }) {
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [serviceDate, setServiceDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [reminderHours, setReminderHours] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/drones/${droneId}/maintenance`);
    setLoading(false);
    if (!response.ok) {
      setError("Could not load maintenance log");
      return;
    }
    const payload = (await response.json()) as { logs: MaintenanceLog[] };
    setLogs(payload.logs);
    setError(null);
  }, [droneId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addEntry(event: React.FormEvent) {
    event.preventDefault();
    if (!description.trim()) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/drones/${droneId}/maintenance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceDate: new Date(`${serviceDate}T12:00:00`).toISOString(),
        description: description.trim(),
        notes: notes.trim() || undefined,
        reminderThresholdHours: reminderHours
          ? Number(reminderHours)
          : undefined,
      }),
    });
    setBusy(false);
    if (!response.ok) {
      setError("Failed to add maintenance entry");
      return;
    }
    setDescription("");
    setNotes("");
    setReminderHours("");
    await load();
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-muted/15 p-4">
      <h2 className="text-sm font-semibold">Maintenance</h2>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No service records yet. Log prop changes, repairs, or battery cycles.
        </p>
      ) : (
        <ul className="space-y-2">
          {logs.map((log) => (
            <li
              key={log.id}
              className="rounded-xl border border-border/80 bg-background px-3 py-2 text-sm"
            >
              <p className="font-medium">{log.description}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(log.serviceDate)}
                {log.flightHoursAtService != null
                  ? ` · ${log.flightHoursAtService.toFixed(1)} h on airframe`
                  : ""}
                {log.reminderThresholdHours != null
                  ? ` · remind after ${log.reminderThresholdHours} h`
                  : ""}
              </p>
              {log.notes ? (
                <p className="mt-1 text-xs text-muted-foreground">{log.notes}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(event) => void addEntry(event)} className="space-y-2">
        <Input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Service description"
          required
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            type="date"
            value={serviceDate}
            onChange={(event) => setServiceDate(event.target.value)}
          />
          <Input
            type="number"
            min={1}
            step={1}
            value={reminderHours}
            onChange={(event) => setReminderHours(event.target.value)}
            placeholder="Remind after (flight hours)"
          />
        </div>
        <Input
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Notes (optional)"
        />
        <Button type="submit" size="sm" disabled={busy}>
          Add entry
        </Button>
      </form>
    </section>
  );
}
