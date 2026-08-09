"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MissionTemplateDto } from "@/lib/missions/queries";

export function MissionTemplatesPanel() {
  const [templates, setTemplates] = useState<MissionTemplateDto[]>([]);
  const [name, setName] = useState("");
  const [requireSrt, setRequireSrt] = useState(true);
  const [requireLrf, setRequireLrf] = useState(false);
  const [tags, setTags] = useState("");
  const [checklistText, setChecklistText] = useState(
    "Batteries charged\nSD card cleared\nHome point set\nSRT recording enabled",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const response = await fetch("/api/missions");
    if (!response.ok) {
      setError("Failed to load mission templates");
      return;
    }
    const payload = (await response.json()) as {
      templates: MissionTemplateDto[];
    };
    setTemplates(payload.templates);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function createTemplate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const checklist = checklistText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((label, index) => ({
        id: `item-${index + 1}`,
        label,
        required: true,
      }));
    const response = await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        requireSrt,
        requireLrf,
        checklist,
        defaultTags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      }),
    });
    setBusy(false);
    if (!response.ok) {
      setError("Could not create template");
      return;
    }
    setName("");
    await reload();
  }

  async function removeTemplate(id: string) {
    const response = await fetch(`/api/missions/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Could not delete template");
      return;
    }
    await reload();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-border bg-muted/40 p-2">
          <ClipboardList className="size-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold">Mission templates</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Checklists and upload defaults (SRT/LRF, tags). Apply from Upload.
          </p>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <form
        onSubmit={createTemplate}
        className="space-y-3 rounded-2xl border border-border p-4"
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Template name (e.g. Site survey)"
        />
        <textarea
          value={checklistText}
          onChange={(event) => setChecklistText(event.target.value)}
          rows={4}
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
          placeholder="Checklist items, one per line"
        />
        <Input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="Default tags (comma separated)"
        />
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={requireSrt}
              onChange={(event) => setRequireSrt(event.target.checked)}
            />
            Require SRT
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={requireLrf}
              onChange={(event) => setRequireLrf(event.target.checked)}
            />
            Require LRF
          </label>
        </div>
        <Button type="submit" disabled={busy || !name.trim()}>
          <Plus className="size-4" />
          Create template
        </Button>
      </form>

      <div className="space-y-2">
        {templates.map((template) => (
          <div
            key={template.id}
            className="rounded-xl border border-border px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{template.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {template.requireSrt ? "SRT required · " : ""}
                  {template.requireLrf ? "LRF required · " : ""}
                  {template.checklist.length} checklist item
                  {template.checklist.length === 1 ? "" : "s"}
                  {template.defaultTags.length
                    ? ` · tags: ${template.defaultTags.join(", ")}`
                    : ""}
                </p>
                {template.checklist.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                    {template.checklist.map((item) => (
                      <li key={item.id}>{item.label}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => void removeTemplate(template.id)}
                aria-label="Delete template"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No templates yet.</p>
        ) : null}
      </div>
    </div>
  );
}