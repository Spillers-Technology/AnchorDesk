import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "../api/client";
import { setReplayUser } from "../openreplay";

interface AuthState {
  user: api.AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (u: api.AuthUser) => void;
  logout: () => Promise<void>;
  isAdmin: boolean;
  canWrite: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<api.AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { user } = await api.getMe();
      setUserState(user);
    } catch {
      // 401 (or any failure) → treat as logged out.
      setUserState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUserState(null);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setReplayUser(user?.username ?? null);
  }, [user]);

  const value: AuthState = {
    user,
    loading,
    refresh,
    setUser: setUserState,
    logout,
    isAdmin: user?.role === "admin",
    canWrite: user?.role === "admin" || user?.role === "technician",
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
