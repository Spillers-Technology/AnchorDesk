/**
 * Pull the one-time secret out of the fragment and scrub it before React
 * mounts or any portal API request runs. Fragments are not sent to the server;
 * verification happens through an explicit JSON POST.
 */
export function readAndScrubMagicToken(
  location: Location = window.location,
  history: History = window.history,
): string | null {
  const fragment = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  const params = new URLSearchParams(fragment);
  if (!params.has("token")) return null;

  const token = params.get("token");
  history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  return token?.trim() || null;
}

