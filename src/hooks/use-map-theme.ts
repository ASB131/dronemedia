"use client";

import { useEffect, useState } from "react";

import {
  readDocumentMapTheme,
  type MapTheme,
} from "@/lib/map/tiles";

/** Follows the app light/dark class on <html>. */
export function useMapTheme(): MapTheme {
  const [theme, setTheme] = useState<MapTheme>(() =>
    typeof document !== "undefined" ? readDocumentMapTheme() : "light",
  );

  useEffect(() => {
    const sync = () => setTheme(readDocumentMapTheme());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}
