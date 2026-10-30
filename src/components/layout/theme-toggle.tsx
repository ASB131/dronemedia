"use client";

import { useCallback, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

function readEffectiveDark() {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

function applyTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  root.classList.add("theme-changing");
  const dark = theme === "dark";
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  root.style.colorScheme = dark ? "dark" : "light";
  try {
    localStorage.setItem("dm-theme", theme);
  } catch {
    // ignore
  }
  window.setTimeout(() => root.classList.remove("theme-changing"), 50);
}

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(readEffectiveDark());
    const onPrefs = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { theme?: "light" | "dark" | "system" }
        | undefined;
      if (detail?.theme === "dark") setDark(true);
      else if (detail?.theme === "light") setDark(false);
      else if (detail?.theme === "system") setDark(readEffectiveDark());
    };
    window.addEventListener("dm-preferences", onPrefs);
    return () => window.removeEventListener("dm-preferences", onPrefs);
  }, []);

  const toggle = useCallback(() => {
    const next = dark ? "light" : "dark";
    applyTheme(next);
    setDark(next === "dark");
    window.dispatchEvent(
      new CustomEvent("dm-preferences", { detail: { theme: next } }),
    );
    void fetch("/api/account/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    });
  }, [dark]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="shrink-0 text-foreground"
      onClick={() => toggle()}
    >
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </Button>
  );
}
