export type MapTheme = "light" | "dark";

export function readDocumentMapTheme(): MapTheme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
