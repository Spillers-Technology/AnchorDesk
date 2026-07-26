import type { CSSProperties } from "react";

export type ChartPaletteSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

type ChartCssVariables = CSSProperties & Record<`--ad-chart-cat-${ChartPaletteSlot}`, string>;

const LIGHT = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
] as const;

const DARK = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
] as const;

/** The validated reporting palette is selected explicitly by mode. It never
 * derives from a user's MUI primary color and is never filter-transformed. */
export function chartCssVars(mode: "light" | "dark"): ChartCssVariables {
  const values = mode === "dark" ? DARK : LIGHT;
  return Object.fromEntries(
    values.map((value, index) => [`--ad-chart-cat-${index + 1}`, value])
  ) as unknown as ChartCssVariables;
}

/** Stable identity reference for SVG/CSS marks. Slots are never array-rank based. */
export function chartColor(slot: ChartPaletteSlot): string {
  return `var(--ad-chart-cat-${slot})`;
}
