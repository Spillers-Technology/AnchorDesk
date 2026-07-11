import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { buildTheme, isThemeId, DEFAULT_THEME_ID, type ThemeId } from "../theme";
import { useAuth } from "../auth/AuthContext";
import * as api from "../api/client";

/**
 * App-wide theming. Owns the selected palette and the MUI ThemeProvider so both
 * the login screen and the dashboard share one theme. Selection is per-user:
 * persisted to the server (User.themePref) and mirrored in localStorage so the
 * chosen palette applies instantly on load, before the /auth/me round-trip.
 */

const STORAGE_KEY = "anchordesk.theme";

interface ThemeModeState {
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
}

const ThemeModeContext = createContext<ThemeModeState | undefined>(undefined);

function initialThemeId(): ThemeId {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  return isThemeId(stored) ? stored : DEFAULT_THEME_ID;
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const { user, setUser } = useAuth();
  const [themeId, setThemeIdState] = useState<ThemeId>(initialThemeId);

  // Adopt the server-stored preference once the user resolves (source of truth
  // for that account); keep localStorage in sync so the next load is instant.
  useEffect(() => {
    if (user && isThemeId(user.themePref) && user.themePref !== themeId) {
      setThemeIdState(user.themePref);
      localStorage.setItem(STORAGE_KEY, user.themePref);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.themePref]);

  const setThemeId = useCallback((id: ThemeId) => {
    setThemeIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
    if (!user) return;
    setUser({ ...user, themePref: id });
    // The dev administrator has no database row; the endpoint deliberately
    // treats that account as local-only while keeping the same client flow.
    api.setMyTheme(id).catch(() => {});
  }, [setUser, user]);

  const theme = useMemo(() => buildTheme(themeId), [themeId]);
  const value = useMemo(() => ({ themeId, setThemeId }), [themeId, setThemeId]);

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeModeState {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error("useThemeMode must be used within an AppThemeProvider");
  return ctx;
}
