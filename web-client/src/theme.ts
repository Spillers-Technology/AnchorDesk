import { createTheme, alpha, type Theme } from "@mui/material/styles";

type PaletteMode = "light" | "dark";

/**
 * Theming system. AnchorDesk ships several selectable palettes (a per-user
 * preference — see AuthContext / AccountMenu). Every palette shares the same
 * shape, typography, and component styling so the product feels consistent;
 * only the colors and light/dark mode change. Add a palette by adding one entry
 * to PALETTES — `buildTheme` derives divider/table/selection styling from its
 * tokens, so nothing else needs to change.
 */

export type ThemeId =
  | "default-light"
  | "default-dark"
  | "solarized-light"
  | "solarized-dark"
  | "nord"
  | "gruvbox"
  | "dracula";

export interface PaletteSpec {
  id: ThemeId;
  label: string;
  mode: PaletteMode;
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  bgDefault: string;
  bgPaper: string;
  textPrimary: string;
  textSecondary: string;
  divider: string;
  /** Subtle fill behind table headers / muted surfaces. */
  headFill: string;
}

export const PALETTES: Record<ThemeId, PaletteSpec> = {
  "default-light": {
    id: "default-light", label: "Default Light", mode: "light",
    primary: "#4f46e5", secondary: "#0ea5e9",
    success: "#16a34a", warning: "#d97706", error: "#dc2626",
    bgDefault: "#f4f5f9", bgPaper: "#ffffff",
    textPrimary: "#1f2430", textSecondary: "#5b6472",
    divider: "#e6e8ef", headFill: "#fafbfd",
  },
  "default-dark": {
    id: "default-dark", label: "Default Dark", mode: "dark",
    primary: "#818cf8", secondary: "#38bdf8",
    success: "#34d399", warning: "#fbbf24", error: "#f87171",
    bgDefault: "#0f1116", bgPaper: "#181b24",
    textPrimary: "#e7e9f2", textSecondary: "#a5abbd",
    divider: "#2a2f3c", headFill: "#1e222d",
  },
  "solarized-light": {
    id: "solarized-light", label: "Solarized Light", mode: "light",
    primary: "#268bd2", secondary: "#2aa198",
    success: "#859900", warning: "#b58900", error: "#dc322f",
    bgDefault: "#fdf6e3", bgPaper: "#fbf3df",
    textPrimary: "#586e75", textSecondary: "#657b83",
    divider: "#e7dfc6", headFill: "#eee8d5",
  },
  "solarized-dark": {
    id: "solarized-dark", label: "Solarized Dark", mode: "dark",
    primary: "#268bd2", secondary: "#2aa198",
    success: "#859900", warning: "#b58900", error: "#dc322f",
    bgDefault: "#002b36", bgPaper: "#073642",
    textPrimary: "#93a1a1", textSecondary: "#839496",
    divider: "#0a3f4c", headFill: "#073642",
  },
  nord: {
    id: "nord", label: "Nord", mode: "dark",
    primary: "#88c0d0", secondary: "#81a1c1",
    success: "#a3be8c", warning: "#ebcb8b", error: "#bf616a",
    bgDefault: "#2e3440", bgPaper: "#3b4252",
    textPrimary: "#e5e9f0", textSecondary: "#b8c0d0",
    divider: "#434c5e", headFill: "#353b49",
  },
  gruvbox: {
    id: "gruvbox", label: "Gruvbox", mode: "dark",
    primary: "#83a598", secondary: "#fe8019",
    success: "#b8bb26", warning: "#fabd2f", error: "#fb4934",
    bgDefault: "#282828", bgPaper: "#32302f",
    textPrimary: "#ebdbb2", textSecondary: "#a89984",
    divider: "#504945", headFill: "#3c3836",
  },
  dracula: {
    id: "dracula", label: "Dracula", mode: "dark",
    primary: "#bd93f9", secondary: "#ff79c6",
    success: "#50fa7b", warning: "#f1fa8c", error: "#ff5555",
    bgDefault: "#282a36", bgPaper: "#343746",
    textPrimary: "#f8f8f2", textSecondary: "#a6accd",
    divider: "#44475a", headFill: "#2f3143",
  },
};

export const THEME_OPTIONS: { id: ThemeId; label: string; mode: PaletteMode }[] =
  Object.values(PALETTES).map((p) => ({ id: p.id, label: p.label, mode: p.mode }));

export const DEFAULT_THEME_ID: ThemeId = "default-light";

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && v in PALETTES;
}

export function buildTheme(id: ThemeId): Theme {
  const p = PALETTES[id] ?? PALETTES[DEFAULT_THEME_ID];
  return createTheme({
    palette: {
      mode: p.mode,
      primary: { main: p.primary },
      secondary: { main: p.secondary },
      success: { main: p.success },
      warning: { main: p.warning },
      error: { main: p.error },
      background: { default: p.bgDefault, paper: p.bgPaper },
      text: { primary: p.textPrimary, secondary: p.textSecondary },
      divider: p.divider,
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: "'Inter', 'Roboto', 'Segoe UI', Arial, sans-serif",
      h4: { fontWeight: 700, letterSpacing: "-0.02em" },
      h5: { fontWeight: 700, letterSpacing: "-0.01em" },
      h6: { fontWeight: 600 },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      button: { textTransform: "none", fontWeight: 600 },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 10, paddingInline: 16 } },
      },
      MuiPaper: {
        styleOverrides: {
          outlined: { borderColor: p.divider },
          rounded: { borderRadius: 14 },
        },
      },
      MuiCard: {
        defaultProps: { variant: "outlined" },
        styleOverrides: { root: { borderRadius: 14 } },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            boxShadow: `0 1px 0 ${alpha("#000", 0.06)}`,
          },
        },
      },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiTableCell: {
        styleOverrides: {
          head: { fontWeight: 700, color: p.textSecondary, backgroundColor: p.headFill },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            margin: "2px 8px",
            "&.Mui-selected": {
              backgroundColor: alpha(p.primary, 0.14),
              "&:hover": { backgroundColor: alpha(p.primary, 0.2) },
            },
          },
        },
      },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
      MuiTextField: { defaultProps: { size: "small" } },
    },
  });
}

/** Back-compat default export (default-light) for any non-themed entry points. */
export const theme = buildTheme(DEFAULT_THEME_ID);

export default theme;
