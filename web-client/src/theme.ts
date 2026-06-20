import { createTheme, alpha } from "@mui/material/styles";

/**
 * Shared application theme. A refined Material surface: a calm indigo primary,
 * soft neutral canvas, tighter typography, and consistent rounding/elevation so
 * cards, dialogs, and inputs feel like one product rather than default MUI.
 */
const primary = "#4f46e5"; // indigo
const secondary = "#0ea5e9"; // sky

export const theme = createTheme({
  palette: {
    primary: { main: primary },
    secondary: { main: secondary },
    success: { main: "#16a34a" },
    warning: { main: "#d97706" },
    error: { main: "#dc2626" },
    background: { default: "#f4f5f9", paper: "#ffffff" },
    text: { primary: "#1f2430", secondary: "#5b6472" },
    divider: "#e6e8ef",
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
        outlined: { borderColor: "#e6e8ef" },
        rounded: { borderRadius: 14 },
      },
    },
    MuiCard: {
      defaultProps: { variant: "outlined" },
      styleOverrides: { root: { borderRadius: 14 } },
    },
    MuiAppBar: {
      styleOverrides: {
        root: { backgroundImage: "none", boxShadow: `0 1px 0 ${alpha("#000", 0.06)}` },
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 700, color: "#5b6472", backgroundColor: "#fafbfd" },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          margin: "2px 8px",
          "&.Mui-selected": {
            backgroundColor: alpha(primary, 0.1),
            "&:hover": { backgroundColor: alpha(primary, 0.16) },
          },
        },
      },
    },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
    MuiTextField: { defaultProps: { size: "small" } },
  },
});

export default theme;
