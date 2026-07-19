// Bridge to the runtime-configured OpenReplay loader (public/openreplay.js —
// a no-op unless the container sets OPENREPLAY_PROJECT_KEY). Before the
// tracker bundle loads, window.OpenReplay is the snippet's command queue;
// after load it is the live API. Both expose setUserID, so this works
// whenever it is called.
interface ReplayApi {
  setUserID?: (id: string) => void;
}

declare global {
  interface Window {
    OpenReplay?: ReplayApi;
  }
}

/** Stamp the current replay session with the signed-in username so sessions
 * are searchable per user. Safe to call when tracking is disabled. */
export function setReplayUser(username: string | null): void {
  if (username && typeof window.OpenReplay?.setUserID === "function") {
    window.OpenReplay.setUserID(username);
  }
}
