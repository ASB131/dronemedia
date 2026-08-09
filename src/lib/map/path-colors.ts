/** Distinct colors for multi-clip flight segments. */
const PATH_COLORS = [
  "#4250AF",
  "#0d9488",
  "#c2410c",
  "#7c3aed",
  "#be185d",
  "#0369a1",
  "#15803d",
  "#b45309",
  "#4f46e5",
  "#0f766e",
];

const PATH_COLORS_DARK = [
  "#8ab4ff",
  "#5eead4",
  "#fdba74",
  "#c4b5fd",
  "#f9a8d4",
  "#7dd3fc",
  "#86efac",
  "#fcd34d",
  "#a5b4fc",
  "#99f6e4",
];

export function pathColorForIndex(
  index: number,
  theme: "light" | "dark" = "light",
): string {
  const palette = theme === "dark" ? PATH_COLORS_DARK : PATH_COLORS;
  return palette[index % palette.length]!;
}
