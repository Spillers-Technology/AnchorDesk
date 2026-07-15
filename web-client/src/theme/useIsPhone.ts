import { useTheme, useMediaQuery } from "@mui/material";

/**
 * True below the `sm` breakpoint (<600px): phones and folded foldables.
 * Mobile is a first-class supported target — see docs/mobile.md. Use this for
 * layout decisions the theme can't make globally (fullScreen dialogs,
 * collapsing secondary actions, master/detail stacking).
 */
export function useIsPhone(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down("sm"), { noSsr: true });
}
