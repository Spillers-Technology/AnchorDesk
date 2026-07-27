import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as portalApi from "./api";
import type { PortalRequesterPrincipal } from "./types";

export type PortalAuthStatus = "loading" | "anonymous" | "authenticated" | "unavailable";

interface PortalAuthState {
  status: PortalAuthStatus;
  requester: PortalRequesterPrincipal | null;
  notice: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const PortalAuthContext = createContext<PortalAuthState | undefined>(undefined);

function requesterPrincipal(
  requester: Awaited<ReturnType<typeof portalApi.getPortalRequester>>["requester"],
): PortalRequesterPrincipal {
  return { kind: "requester", ...requester };
}

export function PortalAuthProvider({
  initialMagicToken,
  children,
}: {
  initialMagicToken: string | null;
  children: React.ReactNode;
}) {
  const pendingToken = useRef(initialMagicToken);
  const [status, setStatus] = useState<PortalAuthStatus>("loading");
  const [requester, setRequester] = useState<PortalRequesterPrincipal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus("loading");
    setNotice(null);
    const token = pendingToken.current;

    try {
      const response = token
        ? await portalApi.verifyMagicLink(token)
        : await portalApi.getPortalRequester();
      pendingToken.current = null;
      setRequester(requesterPrincipal(response.requester));
      setStatus("authenticated");
    } catch (error) {
      setRequester(null);
      if (
        token
        && error instanceof portalApi.PortalApiError
        && [400, 401, 403, 410].includes(error.status)
      ) {
        pendingToken.current = null;
        setNotice("That sign-in link is invalid or has expired. Request a new one below.");
        setStatus("anonymous");
      } else if (!token && portalApi.isPortalAuthError(error)) {
        setStatus("anonymous");
      } else {
        // Preserve an unverified token in memory so Retry can survive a
        // temporary backend failure without putting the secret back in the URL.
        setStatus("unavailable");
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await portalApi.logoutPortal();
    } catch (error) {
      // A rejected requester session already means there is no usable portal
      // session to preserve. Other failures must remain visible to the caller.
      if (!portalApi.isPortalAuthError(error)) throw error;
    }
    pendingToken.current = null;
    setRequester(null);
    setNotice(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo<PortalAuthState>(
    () => ({ status, requester, notice, refresh, logout }),
    [logout, notice, refresh, requester, status],
  );

  return <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>;
}

export function usePortalAuth(): PortalAuthState {
  const value = useContext(PortalAuthContext);
  if (!value) throw new Error("usePortalAuth must be used within PortalAuthProvider");
  return value;
}
